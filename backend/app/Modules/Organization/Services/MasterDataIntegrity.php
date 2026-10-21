<?php

declare(strict_types=1);

namespace App\Modules\Organization\Services;

use Illuminate\Database\Connection;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\Schema;
use RuntimeException;

/**
 * Referential checks behind the integration foreign keys (company_id and cross-module references
 * of Reference, Parties and Catalog from Phase 2, of Accounting from Phase 3 and of Inventory from Phase 4). Works on table and column names only (no other
 * module's models), so it can run in migrations, commands and on installs missing a module.
 *
 * - orphans(): rows whose reference points at no row at all (what a foreign key would reject).
 * - repairOrphans(): opt-in fix for the references that may safely become NULL; everything else is
 *   only reported and needs a manual decision.
 * - tenancyViolations(): rows referencing a record of another company. Single-column keys cannot
 *   express this, the lookups prevent it on write; this is the read-only audit for old data.
 */
final class MasterDataIntegrity
{
    /** company_id -> companies.id. */
    public const array COMPANY_TABLES = [
        'company_currencies', 'exchange_rates', 'tax_codes', 'payment_terms', 'warehouses', 'locations',
        'cost_centers', 'projects',
        'parties', 'party_addresses', 'party_contacts', 'party_bank_accounts',
        'units', 'unit_conversions', 'item_categories', 'items', 'item_variants', 'item_units',
        'item_barcodes', 'price_lists', 'price_list_lines', 'discount_rules',
    ];

    /**
     * Cross-module references: table, column, referenced table, referenced column, repairable
     * (true: an orphan may be set to NULL without breaking a rule of the owning module).
     *
     * @var list<array{0: string, 1: string, 2: string, 3: string, 4: bool}>
     */
    public const array CROSS_MODULE = [
        ['parties', 'payment_term_id', 'payment_terms', 'id', true],
        ['parties', 'price_list_id', 'price_lists', 'id', true],
        ['items', 'default_tax_code_id', 'tax_codes', 'id', true],
        ['items', 'purchase_tax_code_id', 'tax_codes', 'id', true],
        ['projects', 'party_id', 'parties', 'id', true],
        ['warehouses', 'branch_id', 'branches', 'id', true],
        // NULL would turn a party discount into one for everybody.
        ['discount_rules', 'party_id', 'parties', 'id', false],
        ['company_currencies', 'currency_code', 'currencies', 'code', false],
        ['exchange_rates', 'currency_code', 'currencies', 'code', false],
        ['parties', 'default_currency_code', 'currencies', 'code', true],
        // A risk limit needs its currency.
        ['parties', 'risk_currency_code', 'currencies', 'code', false],
        ['party_bank_accounts', 'currency_code', 'currencies', 'code', true],
        ['price_lists', 'currency_code', 'currencies', 'code', false],
    ];

    /** company_id -> companies.id for the Accounting tables. */
    public const array ACCOUNTING_COMPANY_TABLES = [
        'fiscal_years', 'accounting_periods', 'accounts', 'journal_entries', 'journal_lines',
        'account_balances', 'account_determination_rules',
    ];

    /**
     * Accounting references to other modules: table, column, referenced table, referenced column.
     * None is repairable: ledger rows are evidence and posted ones cannot change at all.
     *
     * @var list<array{0: string, 1: string, 2: string, 3: string}>
     */
    public const array ACCOUNTING_CROSS_MODULE = [
        ['accounts', 'currency_code', 'currencies', 'code'],
        ['journal_lines', 'currency_code', 'currencies', 'code'],
        ['journal_lines', 'party_id', 'parties', 'id'],
        ['journal_lines', 'cost_center_id', 'cost_centers', 'id'],
        ['journal_lines', 'project_id', 'projects', 'id'],
        ['fiscal_years', 'closed_by', 'users', 'id'],
        ['accounting_periods', 'closed_by', 'users', 'id'],
        ['journal_entries', 'posted_by', 'users', 'id'],
        ['journal_entries', 'created_by', 'users', 'id'],
    ];

    /** company_id -> companies.id for the Inventory tables. */
    public const array INVENTORY_COMPANY_TABLES = [
        'stock_warehouse_settings', 'stock_lots', 'stock_serials', 'stock_documents', 'stock_document_lines',
        'stock_movements', 'stock_valuations', 'stock_balances', 'stock_cost_layers', 'stock_reservations',
    ];

    /**
     * Inventory references to other modules (items, units, Reference warehouses and locations,
     * journal entries, users) plus the one same-module key the Inventory migrations left out
     * (document line -> reservation). None is repairable: movements are append-only evidence and
     * posted documents cannot change. stock_balances.location_id / lot_id hold a nil uuid sentinel
     * for "none" and are not constrained; stock_movements.document_id / document_line_id and
     * stock_documents.source_id point at documents of any module (typed by their *_type column).
     *
     * @var list<array{0: string, 1: string, 2: string, 3: string}>
     */
    public const array INVENTORY_CROSS_MODULE = [
        ['stock_warehouse_settings', 'warehouse_id', 'warehouses', 'id'],
        ['stock_lots', 'item_id', 'items', 'id'],
        ['stock_serials', 'item_id', 'items', 'id'],
        ['stock_serials', 'warehouse_id', 'warehouses', 'id'],
        ['stock_serials', 'location_id', 'locations', 'id'],
        ['stock_documents', 'warehouse_id', 'warehouses', 'id'],
        ['stock_documents', 'target_warehouse_id', 'warehouses', 'id'],
        ['stock_documents', 'journal_entry_id', 'journal_entries', 'id'],
        ['stock_documents', 'reversal_journal_entry_id', 'journal_entries', 'id'],
        ['stock_documents', 'posted_by', 'users', 'id'],
        ['stock_documents', 'reversed_by', 'users', 'id'],
        ['stock_documents', 'created_by', 'users', 'id'],
        ['stock_document_lines', 'item_id', 'items', 'id'],
        ['stock_document_lines', 'unit_id', 'units', 'id'],
        ['stock_document_lines', 'location_id', 'locations', 'id'],
        ['stock_document_lines', 'target_location_id', 'locations', 'id'],
        ['stock_document_lines', 'reservation_id', 'stock_reservations', 'id'],
        ['stock_movements', 'item_id', 'items', 'id'],
        ['stock_movements', 'warehouse_id', 'warehouses', 'id'],
        ['stock_movements', 'location_id', 'locations', 'id'],
        ['stock_movements', 'journal_entry_id', 'journal_entries', 'id'],
        ['stock_movements', 'created_by', 'users', 'id'],
        ['stock_valuations', 'item_id', 'items', 'id'],
        ['stock_valuations', 'warehouse_id', 'warehouses', 'id'],
        ['stock_balances', 'item_id', 'items', 'id'],
        ['stock_balances', 'warehouse_id', 'warehouses', 'id'],
        ['stock_cost_layers', 'item_id', 'items', 'id'],
        ['stock_cost_layers', 'warehouse_id', 'warehouses', 'id'],
        ['stock_reservations', 'item_id', 'items', 'id'],
        ['stock_reservations', 'warehouse_id', 'warehouses', 'id'],
        ['stock_reservations', 'created_by', 'users', 'id'],
    ];

    /**
     * References between company scoped records (table, column, referenced table) checked for
     * crossing companies. Global rows (company_id NULL, e.g. seeded tax codes) are allowed.
     *
     * @var list<array{0: string, 1: string, 2: string}>
     */
    public const array TENANT_REFERENCES = [
        ['parties', 'payment_term_id', 'payment_terms'],
        ['parties', 'price_list_id', 'price_lists'],
        ['items', 'default_tax_code_id', 'tax_codes'],
        ['items', 'purchase_tax_code_id', 'tax_codes'],
        ['projects', 'party_id', 'parties'],
        ['projects', 'cost_center_id', 'cost_centers'],
        ['warehouses', 'branch_id', 'branches'],
        ['discount_rules', 'party_id', 'parties'],
        ['journal_lines', 'party_id', 'parties'],
        ['journal_lines', 'cost_center_id', 'cost_centers'],
        ['journal_lines', 'project_id', 'projects'],
        ['stock_documents', 'warehouse_id', 'warehouses'],
        ['stock_documents', 'target_warehouse_id', 'warehouses'],
        ['stock_document_lines', 'item_id', 'items'],
        ['stock_movements', 'item_id', 'items'],
        ['stock_movements', 'warehouse_id', 'warehouses'],
        ['stock_reservations', 'item_id', 'items'],
        ['stock_reservations', 'warehouse_id', 'warehouses'],
    ];

    public function __construct(private readonly Connection $db) {}

    /**
     * Every key the integration migrations add, as table, column, referenced table and column.
     *
     * @return list<array{0: string, 1: string, 2: string, 3: string}>
     */
    public static function companyKeys(): array
    {
        return array_map(static fn (string $table): array => [$table, 'company_id', 'companies', 'id'], self::COMPANY_TABLES);
    }

    /**
     * @return list<array{0: string, 1: string, 2: string, 3: string}>
     */
    public static function crossModuleKeys(): array
    {
        return array_values(array_map(static fn (array $key): array => [$key[0], $key[1], $key[2], $key[3]], self::CROSS_MODULE));
    }

    /**
     * Keys of the Accounting integration migration: company_id of every Accounting table, then the
     * cross-module references.
     *
     * @return list<array{0: string, 1: string, 2: string, 3: string}>
     */
    public static function accountingKeys(): array
    {
        return [
            ...array_map(static fn (string $table): array => [$table, 'company_id', 'companies', 'id'], self::ACCOUNTING_COMPANY_TABLES),
            ...self::ACCOUNTING_CROSS_MODULE,
        ];
    }

    /**
     * Keys of the Inventory integration migration: company_id of every Inventory table, then the
     * cross-module references.
     *
     * @return list<array{0: string, 1: string, 2: string, 3: string}>
     */
    public static function inventoryKeys(): array
    {
        return [
            ...array_map(static fn (string $table): array => [$table, 'company_id', 'companies', 'id'], self::INVENTORY_COMPANY_TABLES),
            ...self::INVENTORY_CROSS_MODULE,
        ];
    }

    /**
     * Orphan counts per "table.column" (only entries with orphans), for the given keys.
     *
     * @param  list<array{0: string, 1: string, 2: string, 3: string}>  $keys
     * @return array<string, int>
     */
    public function orphans(array $keys): array
    {
        $found = [];
        foreach ($keys as [$table, $column, $references, $key]) {
            if (! $this->present($table, $references)) {
                continue;
            }
            $count = $this->orphanQuery($table, $column, $references, $key)->count();
            if ($count > 0) {
                $found["{$table}.{$column}"] = $count;
            }
        }

        return $found;
    }

    /**
     * Fails with the orphan counts before a migration adds foreign keys; nothing is changed.
     *
     * @param  list<array{0: string, 1: string, 2: string, 3: string}>  $keys
     */
    public function assertNoOrphans(array $keys, ?string $hint = null): void
    {
        $orphans = $this->orphans($keys);
        if ($orphans === []) {
            return;
        }
        $lines = array_map(static fn (string $ref, int $count): string => "  {$ref}: {$count}", array_keys($orphans), $orphans);

        throw new RuntimeException(
            "Cannot add foreign keys: rows reference missing records.\n".implode("\n", $lines)."\n"
            .($hint ?? 'Review them with `php artisan master-data:repair-orphans --dry-run`; the command clears the references '
            .'that may become empty, the others need a manual fix. Then run the migration again.'),
        );
    }

    /**
     * Clears repairable orphan references (NULL, version + 1, updated_at now). Returns per
     * "table.column": [count, repaired]; unrepairable ones are reported with repaired = false.
     *
     * @return array<string, array{0: int, 1: bool}>
     */
    public function repairOrphans(bool $dryRun): array
    {
        $report = [];
        $keys = [...array_map(static fn (array $key): array => [...$key, false], self::companyKeys()), ...self::CROSS_MODULE];
        $this->db->transaction(function () use ($keys, $dryRun, &$report): void {
            foreach ($keys as [$table, $column, $references, $key, $repairable]) {
                if (! $this->present($table, $references)) {
                    continue;
                }
                $count = $this->orphanQuery($table, $column, $references, $key)->count();
                if ($count === 0) {
                    continue;
                }
                $report["{$table}.{$column}"] = [$count, $repairable && ! $dryRun];
                if ($repairable && ! $dryRun) {
                    $changes = [$column => null, 'updated_at' => now()];
                    if (Schema::connection($this->db->getName())->hasColumn($table, 'version')) {
                        $changes['version'] = $this->db->raw('version + 1');
                    }
                    $this->orphanQuery($table, $column, $references, $key)->update($changes);
                }
            }
        });

        return $report;
    }

    /**
     * Rows referencing a record of another company, per "table.column".
     *
     * @return array<string, int>
     */
    public function tenancyViolations(): array
    {
        $found = [];
        foreach (self::TENANT_REFERENCES as [$table, $column, $references]) {
            if (! $this->present($table, $references)) {
                continue;
            }
            $count = $this->db->table($table)
                ->join("{$references} as ref", 'ref.id', '=', "{$table}.{$column}")
                ->whereNotNull('ref.company_id')
                ->whereColumn('ref.company_id', '<>', "{$table}.company_id")
                ->count();
            if ($count > 0) {
                $found["{$table}.{$column}"] = $count;
            }
        }

        return $found;
    }

    /**
     * Adds the keys for populated databases: orphans are refused first (clear message, no repair);
     * each key is added NOT VALID in its own short statement (new writes are checked, existing rows
     * are not scanned under the strong lock), then validated in separate statements, which only
     * take a lock that does not block reads or writes. Run outside a migration transaction. Keys
     * that already exist (re-run after a failure) are kept; missing tables are skipped.
     *
     * @param  list<array{0: string, 1: string, 2: string, 3: string}>  $keys
     */
    public function addKeys(array $keys, ?string $hint = null): void
    {
        $keys = array_values(array_filter($keys, fn (array $key): bool => $this->present($key[0], $key[2])));
        $this->assertNoOrphans($keys, $hint);
        foreach ($keys as [$table, $column, $references, $key]) {
            if (! $this->constraintExists($table, self::constraintName($table, $column))) {
                $this->db->statement(sprintf(
                    'ALTER TABLE %s ADD CONSTRAINT %s FOREIGN KEY (%s) REFERENCES %s (%s) ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID',
                    $table, self::constraintName($table, $column), $column, $references, $key,
                ));
            }
        }
        foreach ($keys as [$table, $column]) {
            $this->db->statement(sprintf('ALTER TABLE %s VALIDATE CONSTRAINT %s', $table, self::constraintName($table, $column)));
        }
    }

    /**
     * @param  list<array{0: string, 1: string, 2: string, 3: string}>  $keys
     */
    public function dropKeys(array $keys): void
    {
        foreach (array_reverse($keys) as [$table, $column]) {
            if (Schema::connection($this->db->getName())->hasTable($table)) {
                $this->db->statement(sprintf('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %s', $table, self::constraintName($table, $column)));
            }
        }
    }

    /** Laravel's naming, so the keys look like any other foreign key of the schema. */
    public static function constraintName(string $table, string $column): string
    {
        return "{$table}_{$column}_foreign";
    }

    private function constraintExists(string $table, string $name): bool
    {
        return $this->db->table('pg_constraint')
            ->join('pg_class', 'pg_class.oid', '=', 'pg_constraint.conrelid')
            ->where('pg_constraint.conname', $name)->where('pg_class.relname', $table)->exists();
    }

    private function orphanQuery(string $table, string $column, string $references, string $key): Builder
    {
        return $this->db->table($table)->whereNotNull($column)->whereNotExists(
            fn (Builder $q) => $q->selectRaw('1')->from($references)->whereColumn("{$references}.{$key}", "{$table}.{$column}"),
        );
    }

    private function present(string $table, string $references): bool
    {
        $schema = Schema::connection($this->db->getName());

        return $schema->hasTable($table) && $schema->hasTable($references);
    }
}
