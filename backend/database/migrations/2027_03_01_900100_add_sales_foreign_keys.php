<?php

declare(strict_types=1);

use App\Modules\Organization\Services\MasterDataIntegrity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Foreign keys from the Sales tables to companies, users and the records of other modules they
 * reference (parties, currencies, Reference payment terms / warehouses / cost centers / projects /
 * tax codes, Catalog price lists / items / variants / units, Inventory stock documents and
 * reservations, Accounting journal entries, Workflow approval requests). Sales keeps these columns
 * as plain uuids and checks them through Contracts in the active company; these keys add the
 * database guarantee at integration. Dated 2027_03_01_9xxxxx so it runs after every Sales
 * migration (1xxxxx schema, 2xxxxx reports). The list lives in MasterDataIntegrity::salesKeys().
 *
 * ON DELETE / ON UPDATE: RESTRICT for all of them.
 * - company_id on every sales table: issued invoices and posted deliveries are evidence; purging a
 *   tenant must be a deliberate, ordered process.
 * - master records (party, item, unit, warehouse, tax code ...) are soft deleted or deactivated by
 *   their modules; a hard delete of one that a sales document uses is refused (SET NULL would hit
 *   the issued invoice / posted delivery triggers, CASCADE would erase documents).
 * - journal_entry_id / reversal_journal_entry_id, stock_document_id / reversal_stock_document_id
 *   and the *_by user columns: which entry or stock document carries the value and who acted must
 *   never be rewritten.
 * - Not constrained: source_id / source_line_id (documents of any type, typed by source_type) and
 *   e_document_uuid (an external identifier). Links inside the module are keys of the Sales
 *   migration already.
 * - Company consistency (a document's party belongs to its company) is enforced by the lookups;
 *   `php artisan master-data:audit-tenancy` also reports old rows that cross companies.
 *
 * Populated databases: rows referencing missing records stop the migration with counts per
 * table.column and nothing is repaired. Keys are added NOT VALID and validated in separate
 * statements outside one migration transaction, so write locks stay short. Tables of a module that
 * is not installed are skipped. The invariant triggers are not touched: adding or validating a key
 * reads rows, it never updates them.
 */
return new class extends Migration
{
    public $withinTransaction = false;

    public function up(): void
    {
        (new MasterDataIntegrity(DB::connection()))->addKeys(
            MasterDataIntegrity::salesKeys(),
            'Sales rows are never changed automatically: restore the referenced records (or delete the draft documents '
            .'that use them) and run the migration again.',
        );
    }

    public function down(): void
    {
        (new MasterDataIntegrity(DB::connection()))->dropKeys(MasterDataIntegrity::salesKeys());
    }
};
