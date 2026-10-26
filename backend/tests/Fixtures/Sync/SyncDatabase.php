<?php

declare(strict_types=1);

namespace Tests\Fixtures\Sync;

use Illuminate\Contracts\Console\Kernel;
use Illuminate\Database\Connection;
use Illuminate\Foundation\Testing\DatabaseTruncation;
use Illuminate\Foundation\Testing\RefreshDatabaseState;

/**
 * DatabaseTruncation for sync read tests: their writes must commit.
 *
 * Under RefreshDatabase every row a test writes carries the xid of the test's own open
 * transaction, and the pull horizon pg_snapshot_xmin(pg_current_snapshot()) can never pass
 * that xid, so pull would return nothing. Tests using this trait commit for real; committed
 * rows are removed before and after each test.
 *
 * Differences from the stock trait, so the rest of the suite (RefreshDatabase, same process)
 * keeps working:
 * - Rows are deleted with triggers and foreign keys off (session_replication_role = replica)
 *   instead of TRUNCATE ... CASCADE, which the append-only guards (e.g. stock_movements)
 *   refuse, and which would make the sync triggers write tombstones while cleaning up.
 * - Tables that migrations seed are left alone; they are recorded once per process while
 *   only seed rows exist.
 * - The table list is read each time, so fixture tables created by a test are cleaned too.
 */
trait SyncDatabase
{
    use DatabaseTruncation;

    /** @var list<string>|null tables holding migration seed rows */
    private static ?array $seededTables = null;

    protected function truncateDatabaseTables(): void
    {
        if (! RefreshDatabaseState::$migrated) {
            $this->artisan('migrate:fresh', $this->migrateFreshUsing());
            $this->app[Kernel::class]->setArtisan(null);
            RefreshDatabaseState::$migrated = true;
        }

        $this->deleteCommittedRows();
    }

    protected function tearDownSyncDatabase(): void
    {
        $this->deleteCommittedRows();
    }

    private function deleteCommittedRows(): void
    {
        /** @var Connection $db */
        $db = $this->app['db']->connection();
        $seeded = $this->seededTables($db);
        $migrations = $this->migrationsTable();
        $tables = array_values(array_filter(
            $this->tableNames($db),
            static fn (string $t): bool => ! in_array($t, $seeded, true) && $t !== $migrations && ! str_ends_with($t, '.'.$migrations),
        ));

        $db->transaction(static function () use ($db, $tables): void {
            $db->statement('SET LOCAL session_replication_role = replica');

            foreach ($tables as $table) {
                $db->table($table)->delete();
            }
        });
    }

    /**
     * Computed once per process, before this trait's first cleanup, while only seed rows
     * exist: right after migrate:fresh, or after RefreshDatabase tests (which roll back).
     *
     * @return list<string>
     */
    private function seededTables(Connection $db): array
    {
        if (self::$seededTables !== null) {
            return self::$seededTables;
        }

        $seeded = [];

        foreach ($this->tableNames($db) as $table) {
            if ($db->table($table)->exists()) {
                $seeded[] = $table;
            }
        }

        return self::$seededTables = $seeded;
    }

    /**
     * @return list<string>
     */
    private function tableNames(Connection $db): array
    {
        $schema = $db->getSchemaBuilder();

        return array_map(
            static fn (array $table): string => $table['schema_qualified_name'],
            $schema->getTables($schema->getCurrentSchemaListing()),
        );
    }

    private function migrationsTable(): string
    {
        $migrations = $this->app['config']->get('database.migrations');
        $table = is_array($migrations) ? ($migrations['table'] ?? 'migrations') : $migrations;

        return is_string($table) ? $table : 'migrations';
    }
}
