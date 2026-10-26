<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
 * One row per deleted (or soft-deleted) syncable row, written only by the sync_tombstone()
 * trigger. Keyed by table, not by sync resource name; adapters map a resource to its table.
 * company_id is NULL for global tables (and for system rows of company_or_global tables).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sync_tombstones', function (Blueprint $table): void {
            $table->string('resource_table', 63);
            $table->uuid('row_id');
            $table->uuid('company_id')->nullable();
            $table->uuid('parent_id')->nullable();
            $table->string('reason', 16);
            // Delete time; tombstones older than the retention window are pruned by it.
            $table->timestampTz('deleted_at')->index();

            $table->primary(['resource_table', 'row_id']);
        });

        DB::unprepared(<<<'SQL'
            ALTER TABLE sync_tombstones ADD COLUMN sync_txid xid8 NOT NULL;
            ALTER TABLE sync_tombstones ADD CONSTRAINT sync_tombstones_reason_check
                CHECK (reason IN ('deleted', 'soft_deleted'));
            CREATE INDEX sync_tombstones_position_index ON sync_tombstones (resource_table, company_id, sync_txid, row_id);
            SQL);
    }

    public function down(): void
    {
        Schema::dropIfExists('sync_tombstones');
    }
};
