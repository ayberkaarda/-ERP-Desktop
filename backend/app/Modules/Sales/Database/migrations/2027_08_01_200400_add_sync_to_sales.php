<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Sync positions for the sales documents (sales-quotes, sales-orders, sales-deliveries,
 * sales-invoices, sales-returns): every header table is syncable, every line table touches its
 * header, since lines are pulled only as the `lines` embed.
 *
 * Existing guards keep working: zz_sync_touch runs after them, so the to_jsonb(OLD)/to_jsonb(NEW)
 * comparisons of sales_invoices_guard see sync_txid unchanged, and a parent touch of an issued,
 * cancelled or reversed invoice changes no kept column and keeps the status, which that guard
 * already allows. sales_deliveries_guard refuses every update of a posted or cancelled delivery
 * except the cancellation, so it lets the parent touch through: sync_touching() and no column
 * but sync_txid differs. The flag alone is not enough (any session can set the setting), so a
 * data change with it on is refused like any other. Line guards stay as they are: they refuse
 * the line change itself, before any touch happens.
 *
 * Invoices embed returnable_serials (serials shipped on the line and not on a live return), which
 * depends on the returns of the invoice. A return's insert, update or delete therefore touches
 * its invoice (sync_txid only; version and updated_at stay); return line changes touch the
 * return first, so they reach the invoice too.
 */
return new class extends Migration
{
    /** Header table => line table. */
    private const array TABLES = [
        'sales_quotes' => 'sales_quote_lines',
        'sales_orders' => 'sales_order_lines',
        'sales_deliveries' => 'sales_delivery_lines',
        'sales_invoices' => 'sales_invoice_lines',
        'sales_returns' => 'sales_return_lines',
    ];

    private const string DELIVERY_GUARD = <<<'SQL'
        CREATE OR REPLACE FUNCTION sales_deliveries_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE
            kept text[] := ARRAY['status', 'version', 'updated_at', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'reversal_stock_document_id', 'reversal_date'];
        BEGIN
            IF TG_OP = 'UPDATE' AND sync_touching() AND (to_jsonb(NEW) - 'sync_txid') = (to_jsonb(OLD) - 'sync_txid') THEN
                RETURN NEW;
            END IF;
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
        $$;
        SQL;

    /** The guard as 2027_03_01_200100 left it. */
    private const string PREVIOUS_DELIVERY_GUARD = <<<'SQL'
        CREATE OR REPLACE FUNCTION sales_deliveries_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE
            kept text[] := ARRAY['status', 'version', 'updated_at', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'reversal_stock_document_id', 'reversal_date'];
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
        $$;
        SQL;

    /** Return statements that touch their invoice (statement level, like syncable() parent touches). */
    private const array RETURN_TOUCH = [
        'insert' => 'AFTER INSERT ON sales_returns REFERENCING NEW TABLE AS sync_new',
        'update' => 'AFTER UPDATE ON sales_returns REFERENCING OLD TABLE AS sync_old NEW TABLE AS sync_new',
        'delete' => 'AFTER DELETE ON sales_returns REFERENCING OLD TABLE AS sync_old',
    ];

    public function up(): void
    {
        DB::unprepared(self::DELIVERY_GUARD);

        foreach (self::TABLES as $header => $lines) {
            Schema::table($header, function (Blueprint $t): void {
                $t->syncable();
            });
            Schema::table($lines, function (Blueprint $t) use ($header): void {
                $t->syncable(parent: $header, parentKey: ['document_id']);
            });
        }

        foreach (self::RETURN_TOUCH as $event => $when) {
            DB::statement("CREATE TRIGGER sales_returns_touch_invoice_{$event} {$when} FOR EACH STATEMENT EXECUTE FUNCTION sync_touch_parent('sales_invoices', 'invoice_id', 'id')");
        }
    }

    public function down(): void
    {
        foreach (array_keys(self::RETURN_TOUCH) as $event) {
            DB::statement("DROP TRIGGER IF EXISTS sales_returns_touch_invoice_{$event} ON sales_returns");
        }

        foreach (array_reverse(self::TABLES, true) as $header => $lines) {
            Schema::table($lines, function (Blueprint $t) use ($header): void {
                $t->dropSyncable(parent: $header);
            });
            Schema::table($header, function (Blueprint $t): void {
                $t->dropSyncable();
            });
        }

        DB::unprepared(self::PREVIOUS_DELIVERY_GUARD);
    }
};
