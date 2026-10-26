<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
 * Tombstone floor per (table, company): the largest sync_txid among tombstones that pruning
 * has removed. It only grows. A cursor at or below it (cursor.txid <= floor_txid, see
 * App\Core\Sync\Cursor::expiredBy) may have missed a pruned delete and gets
 * `reset: cursor_expired`; an initial download (cursor null) is not affected.
 * company_id NULL holds the floor of global rows, so NULLs are not distinct in the key.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sync_watermarks', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->string('resource_table', 63);
            $table->uuid('company_id')->nullable();
            $table->timestampTz('pruned_at');
        });

        DB::unprepared(<<<'SQL'
            ALTER TABLE sync_watermarks ADD COLUMN floor_txid xid8 NOT NULL;
            CREATE UNIQUE INDEX sync_watermarks_scope_unique ON sync_watermarks (resource_table, company_id) NULLS NOT DISTINCT;
            SQL);
    }

    public function down(): void
    {
        Schema::dropIfExists('sync_watermarks');
    }
};
