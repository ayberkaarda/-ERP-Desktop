#!/usr/bin/env bash
# Runs the e2e specs inside `xvfb-run dbus-run-session` (desktop-e2e.yml): the
# shell keeps its tokens and database key in the Secret Service, so a keyring
# daemon has to be unlocked on the session bus first.
set -euo pipefail

eval "$(printf 'keystone-e2e' | gnome-keyring-daemon --unlock --components=secrets --daemonize)"
export GNOME_KEYRING_CONTROL SSH_AUTH_SOCK 2>/dev/null || true

printf 'probe' | secret-tool store --label=keystone-e2e-probe service keystone-e2e-probe
test "$(secret-tool lookup service keystone-e2e-probe)" = probe
echo "secret service ready"

cd "$(dirname "$0")/.."
exec node --test --test-concurrency=1 "e2e/*.e2e.mjs"
