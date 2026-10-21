<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Cross-module foreign keys between the Phase 2 master data modules (Reference, Parties, Catalog)
 * and Organization. The modules keep these columns as plain uuids/codes and check them through
 * Contracts (in the active company); these keys add the database guarantee at integration.
 * Dated 2026_12_09 so it runs after every 2026_12_01 module migration.
 *
 * ON DELETE choices (all records involved are soft deleted in normal use, so these only matter
 * for hard deletes / purges, which must be deliberate and ordered):
 * - RESTRICT for every business reference: parties.payment_term_id -> payment_terms,
 *   parties.price_list_id -> price_lists, items.default_tax_code_id / purchase_tax_code_id ->
 *   tax_codes, projects.party_id -> parties, warehouses.branch_id -> branches,
 *   discount_rules.party_id -> parties. Silently nulling a party's terms or an item's tax code
 *   (SET NULL) would change how future documents are priced and taxed; CASCADE would destroy master
 *   data. A purge therefore has to clear or delete the referencing rows first.
 * - Currency code columns -> currencies(code) (global table, code is unique), RESTRICT on delete
 *   and on update: company_currencies, exchange_rates, parties.default_currency_code /
 *   risk_currency_code, party_bank_accounts.currency_code, price_lists.currency_code.
 * - Same-module keys already exist in the module migrations (e.g. projects.cost_center_id ->
 *   cost_centers, NO ACTION, which behaves like RESTRICT) and are not repeated here.
 * - Not constrained: discount_rules.scope_ref (points at an item, a category or a party depending
 *   on scope), approval/file polymorphic ids.
 * - Company consistency (a party's payment term belongs to the same company) is enforced by the
 *   lookups (422 for ids of another company), not by composite keys.
 * - Keys whose tables are missing (module not installed) are skipped.
 */
return new class extends Migration
{
    /** @var list<array{0: string, 1: string, 2: string, 3: string}> table, column, references table, references column */
    private const array KEYS = [
        ['parties', 'payment_term_id', 'payment_terms', 'id'],
        ['parties', 'price_list_id', 'price_lists', 'id'],
        ['items', 'default_tax_code_id', 'tax_codes', 'id'],
        ['items', 'purchase_tax_code_id', 'tax_codes', 'id'],
        ['projects', 'party_id', 'parties', 'id'],
        ['warehouses', 'branch_id', 'branches', 'id'],
        ['discount_rules', 'party_id', 'parties', 'id'],
        ['company_currencies', 'currency_code', 'currencies', 'code'],
        ['exchange_rates', 'currency_code', 'currencies', 'code'],
        ['parties', 'default_currency_code', 'currencies', 'code'],
        ['parties', 'risk_currency_code', 'currencies', 'code'],
        ['party_bank_accounts', 'currency_code', 'currencies', 'code'],
        ['price_lists', 'currency_code', 'currencies', 'code'],
    ];

    public function up(): void
    {
        foreach (self::KEYS as [$table, $column, $references, $key]) {
            if (Schema::hasTable($table) && Schema::hasTable($references)) {
                Schema::table($table, function (Blueprint $t) use ($column, $references, $key): void {
                    $t->foreign($column)->references($key)->on($references)->restrictOnDelete()->restrictOnUpdate();
                });
            }
        }
    }

    public function down(): void
    {
        foreach (array_reverse(self::KEYS) as [$table, $column, $references]) {
            if (Schema::hasTable($table) && Schema::hasTable($references)) {
                Schema::table($table, function (Blueprint $t) use ($column): void {
                    $t->dropForeign([$column]);
                });
            }
        }
    }
};
