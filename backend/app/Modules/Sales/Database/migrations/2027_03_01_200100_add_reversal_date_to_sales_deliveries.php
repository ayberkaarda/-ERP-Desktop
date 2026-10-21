<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The stock reversal date of a cancelled posted delivery (the date its stock and COGS were reversed,
 * which may differ from the moment of cancellation). The posted-delivery guard lets the cancellation
 * set it; existing cancellations take the day of cancelled_at.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE sales_deliveries ADD COLUMN reversal_date date NULL');
        DB::statement('ALTER TABLE sales_deliveries DISABLE TRIGGER sales_deliveries_guard');
        DB::statement("UPDATE sales_deliveries SET reversal_date = (cancelled_at AT TIME ZONE 'UTC')::date WHERE status = 'cancelled' AND posted_at IS NOT NULL");
        DB::statement('ALTER TABLE sales_deliveries ENABLE TRIGGER sales_deliveries_guard');
        DB::statement("ALTER TABLE sales_deliveries ADD CONSTRAINT sales_deliveries_reversal_date_check CHECK (status <> 'cancelled' OR posted_at IS NULL OR reversal_date IS NOT NULL)");
        $this->guard(['status', 'version', 'updated_at', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'reversal_stock_document_id', 'reversal_date']);
    }

    public function down(): void
    {
        $this->guard(['status', 'version', 'updated_at', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'reversal_stock_document_id']);
        DB::statement('ALTER TABLE sales_deliveries DROP CONSTRAINT IF EXISTS sales_deliveries_reversal_date_check');
        DB::statement('ALTER TABLE sales_deliveries DROP COLUMN IF EXISTS reversal_date');
    }

    /** @param list<string> $kept */
    private function guard(array $kept): void
    {
        $list = "ARRAY['".implode("', '", $kept)."']";

        DB::unprepared(<<<SQL
            CREATE OR REPLACE FUNCTION sales_deliveries_guard() RETURNS trigger LANGUAGE plpgsql AS \$\$
            DECLARE
                kept text[] := {$list};
            BEGIN
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
            SQL);
    }
};
