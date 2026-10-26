<?php

declare(strict_types=1);

use App\Modules\Organization\Services\MasterDataIntegrity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Foreign keys from the Inventory tables to companies, users and the records of other modules
 * they reference (Catalog items and units, Reference warehouses and locations, Accounting journal
 * entries). Inventory keeps these columns as plain uuids and checks them through Contracts in the
 * active company; these keys add the database guarantee at integration. Dated 2027_02_01_9xxxxx
 * so it runs after every Inventory migration (1xxxxx schema, 2xxxxx reports). The list lives in
 * MasterDataIntegrity::inventoryKeys().
 *
 * ON DELETE / ON UPDATE: RESTRICT for all of them.
 * - company_id on every stock table: movements are append-only evidence; purging a tenant must be
 *   a deliberate, ordered process.
 * - item, unit, warehouse and location ids: master records are soft deleted by their modules;
 *   a hard delete of one that stock rows use is refused (SET NULL would hit the append-only and
 *   posted-document triggers, CASCADE would erase ledger history). Deleting a Reference warehouse
 *   that has movements is also refused by Reference through Inventory's WarehouseLookup.
 * - journal_entry_id / reversal_journal_entry_id -> journal_entries and posted_by / reversed_by /
 *   created_by -> users: who posted and which entry carries the value must never be rewritten.
 * - stock_document_lines.reservation_id -> stock_reservations: the one same-module key the
 *   Inventory migrations left out; reservations are never deleted, only closed.
 * - Not constrained: stock_balances.location_id / lot_id (nil uuid sentinel for "none"),
 *   stock_movements.document_id / document_line_id and stock_documents.source_id (documents of any
 *   module, typed by document_type / source_type).
 * - Company consistency (a movement's item belongs to its company) is enforced by the lookups;
 *   `php artisan master-data:audit-tenancy` also reports old rows that cross companies.
 *
 * Populated databases: rows referencing missing records stop the migration with counts per
 * table.column and nothing is repaired (ledger rows need a manual decision). Keys are added NOT
 * VALID and validated in separate statements outside one migration transaction, so write locks
 * stay short. Tables of a module that is not installed are skipped. The append-only triggers are
 * not touched: adding or validating a key reads rows, it never updates them.
 */
return new class extends Migration
{
    public $withinTransaction = false;

    public function up(): void
    {
        (new MasterDataIntegrity(DB::connection()))->addKeys(
            MasterDataIntegrity::inventoryKeys(),
            'Stock rows are never changed automatically: restore the referenced records (or delete the draft documents '
            .'that use them) and run the migration again.',
        );
    }

    public function down(): void
    {
        (new MasterDataIntegrity(DB::connection()))->dropKeys(MasterDataIntegrity::inventoryKeys());
    }
};
