<?php

declare(strict_types=1);

namespace Tests\Support;

use Illuminate\Support\Facades\DB;

/**
 * Planner statistics for rows a test inserts inside its RefreshDatabase transaction.
 *
 * Every test rolls its rows back, so autovacuum only ever sees these tables empty. When it
 * cannot truncate the dead pages (a test transaction is using the table) it stores
 * relpages > 0 with reltuples = 0, and the planner then takes every table for one row: the
 * per-request permission join (model_has_roles, roles, role_has_permissions, permissions) and
 * the list queries turn into nested loops over all rows of the transaction, seconds per
 * request instead of milliseconds. Tests that send hundreds of requests over a large seeded
 * world call refresh() once their rows exist. ANALYZE counts the rows of its own uncommitted
 * transaction and its lock keeps autovacuum off the tables until the test ends. Its column
 * statistics roll back with the test; the page and row counts it writes to pg_class are updated
 * in place and stay until the next VACUUM or ANALYZE, which only gives later tests better plans.
 */
final class PlannerStatistics
{
    /** The tables behind every authorization check of an HTTP request. */
    public const array PERMISSION_TABLES = ['model_has_roles', 'roles', 'role_has_permissions', 'permissions'];

    /**
     * @param  list<string>  $tables  none: every table of the database
     */
    public static function refresh(array $tables = []): void
    {
        $grammar = DB::connection()->getQueryGrammar();

        DB::statement(rtrim('ANALYZE '.implode(', ', array_map(static fn (string $table): string => $grammar->wrapTable($table), $tables))));
    }
}
