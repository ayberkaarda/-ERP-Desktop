<?php

declare(strict_types=1);

use App\Modules\Organization\Services\MasterDataIntegrity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Foreign keys from the Accounting tables to companies, users and the master data they reference.
 * Accounting keeps these columns as plain uuids/codes and checks them through Contracts (party,
 * cost center, project and currency lookups in the active company); these keys add the database
 * guarantee at integration. Dated 2027_01_01_9xxxxx so it runs after every Accounting migration
 * (1xxxxx schema, 2xxxxx reports). The list lives in MasterDataIntegrity::accountingKeys().
 *
 * ON DELETE / ON UPDATE: RESTRICT for all of them.
 * - company_id on fiscal_years, accounting_periods, accounts, journal_entries, journal_lines,
 *   account_balances, account_determination_rules: the ledger is legal evidence; purging a tenant
 *   must be a deliberate, ordered process.
 * - journal_lines.party_id / cost_center_id / project_id and the currency codes of accounts and
 *   lines: SET NULL or CASCADE would rewrite posted lines, which the ledger triggers forbid anyway
 *   (KA002), so a hard delete of a referenced record is refused instead.
 * - closed_by / posted_by / created_by -> users: users are soft deleted; a hard delete must not
 *   rewrite who posted or closed (SET NULL would hit the same KA002 trigger on posted entries).
 * - Same-module keys (period, fiscal year, account, entry, reversal links) already exist in the
 *   Accounting migrations and are not repeated. Not constrained: journal_entries.source_id (the
 *   document of any later module, typed by source_type).
 * - Company consistency (a line's party belongs to the entry's company) is enforced by the lookups
 *   (422); `php artisan master-data:audit-tenancy` also reports old lines that cross companies.
 *
 * Populated databases: rows referencing missing records stop the migration with counts per
 * table.column and nothing is repaired (ledger rows need a manual decision). Keys are added NOT
 * VALID and validated in separate statements outside one migration transaction, so write locks
 * stay short. Tables of a module that is not installed are skipped.
 */
return new class extends Migration
{
    public $withinTransaction = false;

    public function up(): void
    {
        (new MasterDataIntegrity(DB::connection()))->addKeys(
            MasterDataIntegrity::accountingKeys(),
            'Accounting rows are never changed automatically: restore the referenced records (or correct draft rows) '
            .'and run the migration again.',
        );
    }

    public function down(): void
    {
        (new MasterDataIntegrity(DB::connection()))->dropKeys(MasterDataIntegrity::accountingKeys());
    }
};
