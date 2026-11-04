#!/usr/bin/env bash
# CI runner for Pest with a stall watchdog: a hung run fails with evidence instead of being
# cancelled silently after the job timeout.
#
# Progress goes to a TeamCity log that Pest flushes per test (the console only prints a test
# file's block when the whole file is done, so after a hang the console does not say which test
# was running). When that log has not grown for STALL_SECONDS the watchdog writes a diagnostic
# report (process list, open sockets, Postgres sessions and locks, last progress lines) to
# $DIAG_DIR, then kills the run.
set -uo pipefail

DIAG_DIR="${DIAG_DIR:-${RUNNER_TEMP:-/tmp}/pest-diagnostics}"
STALL_SECONDS="${STALL_SECONDS:-420}"
PROGRESS="$DIAG_DIR/progress.teamcity.log"
mkdir -p "$DIAG_DIR"
: > "$PROGRESS"

php artisan config:clear --ansi || exit 1
php vendor/bin/pest --testsuite=Arch || exit 1

php vendor/bin/pest --testsuite=Unit,Feature --log-teamcity "$PROGRESS" &
PEST_PID=$!

(
    while kill -0 "$PEST_PID" 2>/dev/null; do
        sleep 20
        now=$(date +%s)
        last=$(stat -c %Y "$PROGRESS" 2>/dev/null || echo "$now")
        if (( now - last >= STALL_SECONDS )); then
            {
                echo "== STALL: no Pest progress for $((now - last)) s at $(date -u +%FT%TZ) =="
                echo "== last progress lines =="
                tail -n 15 "$PROGRESS"
                echo "== processes =="
                ps -eo pid,ppid,stat,etimes,pcpu,wchan:24,args --forest | cut -c1-300
                echo "== pest process threads / stack =="
                cat "/proc/$PEST_PID/status" 2>/dev/null | head -12
                cat "/proc/$PEST_PID/stack" 2>/dev/null
                ls -l "/proc/$PEST_PID/fd" 2>/dev/null
                echo "== sockets =="
                (ss -tanp 2>/dev/null || netstat -tanp 2>/dev/null) | head -60
                echo "== postgres sessions =="
                PGPASSWORD=keystone psql -h 127.0.0.1 -p "${DB_PORT:-5433}" -U keystone -d keystone_test -x -c \
                    "select pid, state, wait_event_type, wait_event, now()-xact_start as xact_age, now()-query_start as query_age, left(query, 300) as query from pg_stat_activity where datname = 'keystone_test'" 2>&1
                echo "== postgres locks (not granted) =="
                PGPASSWORD=keystone psql -h 127.0.0.1 -p "${DB_PORT:-5433}" -U keystone -d keystone_test -x -c \
                    "select * from pg_locks where not granted" 2>&1
            } > "$DIAG_DIR/stall-report.txt" 2>&1
            echo "::error::Pest made no progress for ${STALL_SECONDS}s; see the stall-report.txt artifact. Killing the run."
            tail -n 5 "$PROGRESS"
            kill -TERM "$PEST_PID" 2>/dev/null
            sleep 5
            kill -KILL "$PEST_PID" 2>/dev/null
            exit 0
        fi
    done
) &
WATCHDOG_PID=$!

wait "$PEST_PID"
STATUS=$?
kill "$WATCHDOG_PID" 2>/dev/null
if [ -f "$DIAG_DIR/stall-report.txt" ]; then
    exit 124
fi
exit "$STATUS"
