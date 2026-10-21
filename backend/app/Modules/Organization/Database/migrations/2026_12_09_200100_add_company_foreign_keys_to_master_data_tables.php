<?php

declare(strict_types=1);

use App\Modules\Organization\Services\MasterDataIntegrity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Foreign keys from the Reference, Parties and Catalog tables to companies. Dated 2026_12_09 so it
 * runs after those modules' 2026_12_01_1xxxxx/2xxxxx/3xxxxx migrations. The table list lives in
 * MasterDataIntegrity::COMPANY_TABLES.
 *
 * Choices:
 * - company_id: RESTRICT everywhere. Master data is referenced by documents of later phases;
 *   purging a tenant must be a deliberate, ordered process, never a side effect. Companies are
 *   normally soft deleted, so the constraint does not fire in day to day use.
 * - Nullable company_id (exchange_rates: null for global TCMB fixings; tax_codes: null for the
 *   global seeded codes) is constrained the same way; null rows are not checked.
 * - Populated databases: rows of unknown companies stop the migration with counts per table (no
 *   automatic repair: such rows need a manual decision). Keys are added NOT VALID and validated in
 *   separate statements outside one migration transaction, so write locks stay short.
 * - Tables of a module that is not installed are skipped, so a bare install still migrates.
 */
return new class extends Migration
{
    public $withinTransaction = false;

    public function up(): void
    {
        (new MasterDataIntegrity(DB::connection()))->addKeys(MasterDataIntegrity::companyKeys());
    }

    public function down(): void
    {
        (new MasterDataIntegrity(DB::connection()))->dropKeys(MasterDataIntegrity::companyKeys());
    }
};
