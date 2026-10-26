<?php

declare(strict_types=1);

use App\Core\Sync\Schema\Syncable;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * sales_deliveries_guard (KS003) takes the sync touch exemption from Core
 * (Syncable::GUARD_EXEMPTION, sync_touch_only(OLD, NEW)) instead of its own copy of the check.
 * Same rule as 2027_08_01_200400: only an UPDATE inside a sync touch that changes no column but
 * sync_txid passes a posted or cancelled delivery; down() restores that inline form.
 */
return new class extends Migration
{
    /**
     * @param  literal-string  $exemption
     * @return literal-string
     */
    private static function guard(string $exemption): string
    {
        return <<<SQL
            CREATE OR REPLACE FUNCTION sales_deliveries_guard() RETURNS trigger LANGUAGE plpgsql AS \$\$
            DECLARE
                kept text[] := ARRAY['status', 'version', 'updated_at', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'reversal_stock_document_id', 'reversal_date'];
            BEGIN
                {$exemption}
                IF OLD.status = 'draft' THEN
                    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
                END IF;
                IF TG_OP = 'UPDATE' AND OLD.status = 'posted' AND NEW.status = 'cancelled' AND NEW.cancelled_at IS NOT NULL
                   AND (to_jsonb(NEW) - kept) = (to_jsonb(OLD) - kept) THEN
                    RETURN NEW;
                END IF;
                RAISE EXCEPTION USING ERRCODE = 'KS003',
                    MESSAGE = format('sales delivery %s is %s and cannot be changed', coalesce(OLD.number, OLD.id::text), OLD.status);
            END;
            \$\$;
            SQL;
    }

    public function up(): void
    {
        DB::unprepared(self::guard(Syncable::GUARD_EXEMPTION));
    }

    public function down(): void
    {
        DB::unprepared(self::guard("IF TG_OP = 'UPDATE' AND sync_touching() AND (to_jsonb(NEW) - 'sync_txid') = (to_jsonb(OLD) - 'sync_txid') THEN RETURN NEW; END IF;"));
    }
};
