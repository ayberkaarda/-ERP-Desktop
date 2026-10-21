<?php

declare(strict_types=1);

use App\Modules\Organization\Services\MasterDataIntegrity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Cross-module foreign keys between the Phase 2 master data modules (Reference, Parties, Catalog)
 * and Organization. The modules keep these columns as plain uuids/codes and check them through
 * Contracts (in the active company); these keys add the database guarantee at integration.
 * Dated 2026_12_09 so it runs after every 2026_12_01 module migration. The list lives in
 * MasterDataIntegrity::CROSS_MODULE.
 *
 * ON DELETE / ON UPDATE: RESTRICT for all of them. Master data is soft deleted in normal use, so
 * the keys only matter for hard deletes / purges, which must be deliberate and ordered:
 * - business references: parties.payment_term_id -> payment_terms, parties.price_list_id ->
 *   price_lists, items.default_tax_code_id / purchase_tax_code_id -> tax_codes, projects.party_id
 *   -> parties, warehouses.branch_id -> branches, discount_rules.party_id -> parties. SET NULL
 *   would silently change how future documents are priced and taxed; CASCADE would destroy master
 *   data.
 * - currency codes -> currencies(code) (global table, code unique): company_currencies,
 *   exchange_rates, parties.default_currency_code / risk_currency_code,
 *   party_bank_accounts.currency_code, price_lists.currency_code.
 * - Same-module keys already exist in the module migrations (projects.cost_center_id ->
 *   cost_centers, NO ACTION) and are not repeated. Not constrained: discount_rules.scope_ref
 *   (item, category or party depending on scope).
 * - Company consistency (a party's payment term belongs to the same company) is enforced by the
 *   lookups (422), not by composite keys; `php artisan master-data:audit-tenancy` reports old rows
 *   that cross companies.
 *
 * Populated databases: rows referencing missing records stop the migration with counts per
 * table.column (nothing is repaired silently; see `master-data:repair-orphans --dry-run`). Keys are
 * added NOT VALID and validated in separate statements outside one migration transaction, so write
 * locks stay short. Tables of a module that is not installed are skipped.
 */
return new class extends Migration
{
    public $withinTransaction = false;

    public function up(): void
    {
        (new MasterDataIntegrity(DB::connection()))->addKeys(MasterDataIntegrity::crossModuleKeys());
    }

    public function down(): void
    {
        (new MasterDataIntegrity(DB::connection()))->dropKeys(MasterDataIntegrity::crossModuleKeys());
    }
};
