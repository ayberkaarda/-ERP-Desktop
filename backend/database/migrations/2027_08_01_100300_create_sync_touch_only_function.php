<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/*
 * sync_touch_only(OLD, NEW): the one exemption a row guard may grant to a sync touch
 * (App\Core\Sync\Schema\Syncable::GUARD_EXEMPTION). True only inside a sync touch
 * (sync_touching()) AND when no column but sync_txid differs between the two rows. The flag
 * alone proves nothing (any session can set it), so a guard must never return on
 * sync_touching() by itself; with this check a flagged data change is refused like any other.
 * sync_txid itself is restamped by zz_sync_touch afterwards, so a forged value never survives.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION sync_touch_only(old_row anyelement, new_row anyelement) RETURNS boolean
                LANGUAGE sql STABLE AS $$
                SELECT sync_touching()
                    AND coalesce((to_jsonb(old_row) - 'sync_txid') = (to_jsonb(new_row) - 'sync_txid'), false)
            $$;
            SQL);
    }

    public function down(): void
    {
        DB::unprepared('DROP FUNCTION IF EXISTS sync_touch_only(anyelement, anyelement)');
    }
};
