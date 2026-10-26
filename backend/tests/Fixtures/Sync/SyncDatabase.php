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
 * that xid, so pull would return nothing. Tests using this trait commit for real; before and
 * after each test the database is put back into its post-migration state.
 *
 * How, and why not the stock trait:
 * - Once per process, while only migration seed rows exist, the tables that hold rows are
 *   copied into the schema `sync_test_seed`. Cleanup empties every other table and restores
 *   seeded tables row for row from that copy, so rows a test inserted into, changed in or
 *   deleted from a seeded table never reach the next test, and no table keeps rows that
 *   point at removed ones.
 * - It runs with triggers and foreign keys off (session_replication_role = replica, needs a
 *   superuser, as the docker and CI database users are) instead of TRUNCATE ... CASCADE,
 *   which append-only guards (stock_movements) refuse and which would make the sync triggers
 *   write tombstones while cleaning up.
 * - The table list is read each time, so fixture tables created by a test are cleaned too.
 */
trait SyncDatabase
{
    use DatabaseTruncation;

    private static string $seedSchema = 'sync_test_seed';

    /** @var list<string>|null qualified names of the tables restored from the seed copy */
    private static ?array $seededTables = null;

    protected function truncateDatabaseTables(): void
    {
        if (! RefreshDatabaseState::$migrated) {
            $this->artisan('migrate:fresh', $this->migrateFreshUsing());
            $this->app[Kernel::class]->setArtisan(null);
            RefreshDatabaseState::$migrated = true;
        }

        $this->restoreDatabase();
    }

    protected function tearDownSyncDatabase(): void
    {
        $this->restoreDatabase();
    }

    private function restoreDatabase(): void
    {
        /** @var Connection $db */
        $db = $this->app['db']->connection();
        $seeded = $this->snapshotSeeds($db);
        $migrations = $this->migrationsTable();
        $schema = self::$seedSchema;

        $db->transaction(function () use ($db, $seeded, $migrations, $schema): void {
            $db->statement('SET LOCAL session_replication_role = replica');

            foreach ($this->tableNames($db) as $table) {
                if ($table === $migrations || str_ends_with($table, '.'.$migrations)) {
                    continue;
                }

                $quoted = self::quote($table);
                $db->statement("DELETE FROM {$quoted}");

                if (in_array($table, $seeded, true)) {
                    $columns = $this->insertableColumns($db, $table);
                    $copy = '"'.$schema.'".'.self::quote(self::copyName($table));
                    $db->statement("INSERT INTO {$quoted} ({$columns}) OVERRIDING SYSTEM VALUE SELECT {$columns} FROM {$copy}");
                }
            }
        });
    }

    /**
     * Takes the seed copy again from the current state (tests of this trait only).
     */
    protected function retakeSeedSnapshot(): void
    {
        self::$seededTables = null;
        /** @var Connection $db */
        $db = $this->app['db']->connection();
        $this->snapshotSeeds($db);
    }

    /**
     * @return list<string>
     */
    private function snapshotSeeds(Connection $db): array
    {
        if (self::$seededTables !== null) {
            return self::$seededTables;
        }

        $schema = self::$seedSchema;
        $migrations = $this->migrationsTable();
        $seeded = [];

        $db->statement("DROP SCHEMA IF EXISTS \"{$schema}\" CASCADE");
        $db->statement("CREATE SCHEMA \"{$schema}\"");

        foreach ($this->tableNames($db) as $table) {
            if ($table === $migrations || str_ends_with($table, '.'.$migrations) || ! $db->table($table)->exists()) {
                continue;
            }

            $db->statement('CREATE TABLE "'.$schema.'".'.self::quote(self::copyName($table)).' AS TABLE '.self::quote($table));
            $seeded[] = $table;
        }

        return self::$seededTables = $seeded;
    }

    /**
     * Column list without generated columns, which cannot be written.
     */
    private function insertableColumns(Connection $db, string $table): string
    {
        [$schema, $name] = explode('.', $table, 2);
        $columns = $db->table('information_schema.columns')
            ->where('table_schema', $schema)
            ->where('table_name', $name)
            ->where('is_generated', 'NEVER')
            ->orderBy('ordinal_position')
            ->pluck('column_name')
            ->all();

        return implode(', ', array_map(static fn (mixed $c): string => '"'.(is_string($c) ? $c : '').'"', $columns));
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

    private static function quote(string $qualified): string
    {
        return implode('.', array_map(static fn (string $part): string => '"'.$part.'"', explode('.', $qualified)));
    }

    private static function copyName(string $qualified): string
    {
        $name = str_replace('.', '__', $qualified);

        return strlen($name) <= 63 ? $name : 't_'.md5($qualified);
    }
}
