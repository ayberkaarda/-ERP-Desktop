<?php

declare(strict_types=1);

namespace App\Core\Sync\Schema;

use Closure;
use Illuminate\Database\Connection;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Schema\Grammars\Grammar;
use Illuminate\Database\Schema\Grammars\PostgresGrammar;
use Illuminate\Support\Fluent;
use InvalidArgumentException;
use LogicException;

/**
 * Blueprint macros that make a table visible to sync pull.
 *
 *     $table->syncable();                                             // own sync position + tombstones
 *     $table->syncable(parent: 'sales_quotes', parentKey: ['document_id']);  // child: touches its parent
 *     $table->syncable(parent: 'items', parentKey: ['item_id'], tracked: true);  // both
 *     $table->dropSyncable(...same arguments...);                     // in down()
 *
 * A tracked table gets `sync_txid xid8 NOT NULL DEFAULT pg_current_xact_id()`, an index on
 * (company_id, sync_txid, id) â€” (sync_txid, id) when the table has no company_id â€” the
 * sync_touch trigger and the sync_tombstone triggers (AFTER DELETE, plus AFTER UPDATE OF
 * deleted_at when the table soft-deletes). A child (parent given) gets three statement-level
 * triggers that bump the parent's sync_txid once per statement. The trigger functions are
 * created by the 2027_08_01_100000 migration. Laravel's grammar has no xid8 type, so all of
 * this compiles to raw statements, after the table's own create/alter statements.
 *
 * parentKey lists the child columns that reference the parent's `id`; a string key maps a
 * child column to another parent column, and several entries match as one row value.
 */
final class Syncable
{
    public const string COLUMN = 'sync_txid';

    private const string IDENTIFIER = '/^[a-z_][a-z0-9_]{0,62}$/';

    public static function register(): void
    {
        Blueprint::macro('syncable', function (?string $parent = null, array $parentKey = [], ?bool $tracked = null): Blueprint {
            /** @var Blueprint $this */
            $blueprint = $this;
            $connection = $this->connection;
            $columns = static fn (string $name): Closure => static fn (): bool => Syncable::hasColumn($blueprint, $connection, $name);

            $blueprint->addCommand('syncable', [
                'parent' => $parent,
                'parentKey' => $parentKey,
                'tracked' => $tracked ?? $parent === null,
                // Resolved at compile time, when every column of the blueprint is known.
                'hasCompany' => $columns('company_id'),
                'hasSoftDeletes' => $columns('deleted_at'),
            ]);

            return $blueprint;
        });

        Blueprint::macro('dropSyncable', function (?string $parent = null, ?bool $tracked = null): Blueprint {
            /** @var Blueprint $this */
            $this->addCommand('dropSyncable', [
                'parent' => $parent,
                'tracked' => $tracked ?? $parent === null,
            ]);

            return $this;
        });

        Grammar::macro('compileSyncable', function (Blueprint $blueprint, Fluent $command): array {
            /** @var Grammar $this */
            return Syncable::compile($this, $blueprint, $command);
        });

        Grammar::macro('compileDropSyncable', function (Blueprint $blueprint, Fluent $command): array {
            /** @var Grammar $this */
            return Syncable::compileDrop($this, $blueprint, $command);
        });
    }

    /**
     * @param  Fluent<string, mixed>  $command
     * @return list<string>
     */
    public static function compile(Grammar $grammar, Blueprint $blueprint, Fluent $command): array
    {
        self::assertPostgres($grammar);
        $table = self::identifier($blueprint->getTable());
        $statements = [];

        if ($command->get('tracked') === true) {
            $hasCompany = $command->get('hasCompany');
            $hasSoftDeletes = $command->get('hasSoftDeletes');
            $position = ($hasCompany instanceof Closure && $hasCompany() === true) ? 'company_id, sync_txid, id' : 'sync_txid, id';
            $parentColumn = self::tombstoneParentColumn($command);

            $statements[] = "ALTER TABLE \"{$table}\" ADD COLUMN sync_txid xid8 NOT NULL DEFAULT pg_current_xact_id()";
            $statements[] = "CREATE INDEX \"{$table}_sync_position_index\" ON \"{$table}\" ({$position})";
            $statements[] = "CREATE TRIGGER sync_touch BEFORE INSERT OR UPDATE ON \"{$table}\" FOR EACH ROW EXECUTE FUNCTION sync_touch()";
            $statements[] = "CREATE TRIGGER sync_tombstone_delete AFTER DELETE ON \"{$table}\" FOR EACH ROW EXECUTE FUNCTION sync_tombstone('{$parentColumn}')";

            if ($hasSoftDeletes instanceof Closure && $hasSoftDeletes() === true) {
                $statements[] = "CREATE TRIGGER sync_tombstone_soft AFTER UPDATE OF deleted_at ON \"{$table}\" FOR EACH ROW EXECUTE FUNCTION sync_tombstone('{$parentColumn}')";
            }
        }

        $parent = $command->get('parent');

        if (is_string($parent)) {
            $parent = self::identifier($parent);
            $children = implode(',', self::parentColumns($command));
            $targets = implode(',', self::parentTargets($command));

            if ($children === '') {
                throw new InvalidArgumentException("syncable() on {$table}: parentKey is required with a parent.");
            }

            $args = "'{$parent}', '{$children}', '{$targets}'";
            $name = self::parentTrigger($parent);
            $statements[] = "CREATE TRIGGER {$name}_insert AFTER INSERT ON \"{$table}\" REFERENCING NEW TABLE AS sync_new FOR EACH STATEMENT EXECUTE FUNCTION sync_touch_parent({$args})";
            $statements[] = "CREATE TRIGGER {$name}_update AFTER UPDATE ON \"{$table}\" REFERENCING OLD TABLE AS sync_old NEW TABLE AS sync_new FOR EACH STATEMENT EXECUTE FUNCTION sync_touch_parent({$args})";
            $statements[] = "CREATE TRIGGER {$name}_delete AFTER DELETE ON \"{$table}\" REFERENCING OLD TABLE AS sync_old FOR EACH STATEMENT EXECUTE FUNCTION sync_touch_parent({$args})";
        } elseif ($command->get('tracked') !== true) {
            throw new InvalidArgumentException("syncable() on {$table}: nothing to do without tracking or a parent.");
        }

        return $statements;
    }

    /**
     * @param  Fluent<string, mixed>  $command
     * @return list<string>
     */
    public static function compileDrop(Grammar $grammar, Blueprint $blueprint, Fluent $command): array
    {
        self::assertPostgres($grammar);
        $table = self::identifier($blueprint->getTable());
        $statements = [];
        $parent = $command->get('parent');

        if (is_string($parent)) {
            $name = self::parentTrigger(self::identifier($parent));

            foreach (['insert', 'update', 'delete'] as $event) {
                $statements[] = "DROP TRIGGER IF EXISTS {$name}_{$event} ON \"{$table}\"";
            }
        }

        if ($command->get('tracked') === true) {
            $statements[] = "DROP TRIGGER IF EXISTS sync_tombstone_soft ON \"{$table}\"";
            $statements[] = "DROP TRIGGER IF EXISTS sync_tombstone_delete ON \"{$table}\"";
            $statements[] = "DROP TRIGGER IF EXISTS sync_touch ON \"{$table}\"";
            $statements[] = "DROP INDEX IF EXISTS \"{$table}_sync_position_index\"";
            $statements[] = "ALTER TABLE \"{$table}\" DROP COLUMN IF EXISTS sync_txid";
            $statements[] = "DELETE FROM sync_tombstones WHERE resource_table = '{$table}'";
        }

        return $statements;
    }

    /**
     * @internal for the macro; true when the blueprint adds the column or the table has it
     */
    public static function hasColumn(Blueprint $blueprint, Connection $connection, string $column): bool
    {
        foreach ($blueprint->getAddedColumns() as $added) {
            if ($added->get('name') === $column) {
                return true;
            }
        }

        if ($blueprint->creating()) {
            return false;
        }

        return $connection->getSchemaBuilder()->hasColumn($blueprint->getTable(), $column);
    }

    /**
     * @param  Fluent<string, mixed>  $command
     * @return list<string>
     */
    private static function parentColumns(Fluent $command): array
    {
        $keys = $command->get('parentKey');
        $out = [];

        foreach (is_array($keys) ? $keys : [] as $child => $target) {
            $out[] = self::identifier(is_string($child) ? $child : (string) $target);
        }

        return $out;
    }

    /**
     * @param  Fluent<string, mixed>  $command
     * @return list<string>
     */
    private static function parentTargets(Fluent $command): array
    {
        $keys = $command->get('parentKey');
        $out = [];

        foreach (is_array($keys) ? $keys : [] as $child => $target) {
            $out[] = self::identifier(is_string($child) ? (string) $target : 'id');
        }

        return $out;
    }

    /**
     * The child column holding the parent's id, recorded as the tombstone's parent_id.
     *
     * @param  Fluent<string, mixed>  $command
     */
    private static function tombstoneParentColumn(Fluent $command): string
    {
        $children = self::parentColumns($command);
        $targets = self::parentTargets($command);
        $index = array_search('id', $targets, true);

        return $index === false ? ($children[0] ?? '') : $children[$index];
    }

    private static function parentTrigger(string $parent): string
    {
        // Trigger names are limited to 63 bytes; long parent names fall back to a hash.
        return strlen($parent) <= 40 ? "sync_parent_{$parent}" : 'sync_parent_'.substr(md5($parent), 0, 12);
    }

    private static function identifier(string $name): string
    {
        if (preg_match(self::IDENTIFIER, $name) !== 1) {
            throw new InvalidArgumentException("Invalid identifier for syncable(): [{$name}].");
        }

        return $name;
    }

    private static function assertPostgres(Grammar $grammar): void
    {
        if (! $grammar instanceof PostgresGrammar) {
            throw new LogicException('syncable() requires PostgreSQL (xid8, transition tables).');
        }
    }
}
