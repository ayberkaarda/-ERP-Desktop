<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Purchasing documents become visible to sync pull: every header table gets its own sync position
 * and tombstones, every line table touches its header (lines are embedded, not separate
 * resources). RFQ suppliers and quotes are not part of the offline shape (embeds: lines), so they
 * are left alone.
 *
 * Source documents: a receipt or invoice line carries `returnable_quantity`, computed from the
 * return lines that point at it (and, for receipts, from the invoice lines that bill it). A change
 * of those rows, or of the status of their return/invoice, touches the source headers in the same
 * transaction (purchasing_sync_touch_sources, sync_txid only; version and updated_at stay).
 *
 * Guards: those sources are usually posted/booked. purchase_invoices_guard already lets an update
 * that changes nothing through. purchase_receipts_guard refuses every update of a posted receipt,
 * so it gets a narrow exemption: inside a sync touch (sync_touching()) AND with every column but
 * sync_txid unchanged. Any real change of a posted receipt still raises KP003, flag or not.
 */
return new class extends Migration
{
    /** @var array<string, string> header table => line table */
    private const array DOCUMENTS = [
        'purchase_requests' => 'purchase_request_lines',
        'purchase_rfqs' => 'purchase_rfq_lines',
        'purchase_orders' => 'purchase_order_lines',
        'purchase_receipts' => 'purchase_receipt_lines',
        'purchase_invoices' => 'purchase_invoice_lines',
        'purchase_returns' => 'purchase_return_lines',
    ];

    private const string SOURCES_UP = <<<'SQL'
        CREATE OR REPLACE FUNCTION purchasing_sync_touch_sources() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE
            changed text;
            invoice_lines text;
            receipt_lines text;
            -- Only a status change that adds or removes the document from what Quantities counts
            -- (returns: all but cancelled; invoices: all but cancelled/reversed). Payment status moves
            -- (booked/partially_paid/paid) touch nothing, so they take no source lock while holding the invoice.
            return_crossed text := 'SELECT n.id FROM sync_new n JOIN sync_old o ON o.id = n.id WHERE (n.status = ''cancelled'') IS DISTINCT FROM (o.status = ''cancelled'')';
            invoice_crossed text := 'SELECT n.id FROM sync_new n JOIN sync_old o ON o.id = n.id WHERE (n.status IN (''cancelled'', ''reversed'')) IS DISTINCT FROM (o.status IN (''cancelled'', ''reversed''))';
            previous text;
        BEGIN
            -- Rows of this statement: the transition tables differ per operation.
            changed := CASE TG_OP WHEN 'INSERT' THEN 'SELECT * FROM sync_new' WHEN 'DELETE' THEN 'SELECT * FROM sync_old'
                ELSE 'SELECT * FROM sync_new UNION ALL SELECT * FROM sync_old' END;

            IF TG_TABLE_NAME = 'purchase_return_lines' THEN
                invoice_lines := format('SELECT invoice_line_id FROM (%s) c', changed);
                receipt_lines := format('SELECT receipt_line_id FROM (%s) c', changed);
            ELSIF TG_TABLE_NAME = 'purchase_returns' THEN
                invoice_lines := format('SELECT invoice_line_id FROM purchase_return_lines WHERE document_id IN (%s)', return_crossed);
                receipt_lines := format('SELECT receipt_line_id FROM purchase_return_lines WHERE document_id IN (%s)', return_crossed);
            ELSIF TG_TABLE_NAME = 'purchase_invoice_lines' THEN
                receipt_lines := format('SELECT receipt_line_id FROM (%s) c', changed);
            ELSIF TG_TABLE_NAME = 'purchase_invoices' THEN
                receipt_lines := format('SELECT receipt_line_id FROM purchase_invoice_lines WHERE document_id IN (%s)', invoice_crossed);
            END IF;

            previous := current_setting('keystone.sync_touch', true);
            PERFORM set_config('keystone.sync_touch', 'on', true);

            IF invoice_lines IS NOT NULL THEN
                EXECUTE format('UPDATE purchase_invoices SET sync_txid = sync_txid WHERE sync_txid <> pg_current_xact_id()
                    AND id IN (SELECT document_id FROM purchase_invoice_lines WHERE id IN (%s))', invoice_lines);
            END IF;
            IF receipt_lines IS NOT NULL THEN
                EXECUTE format('UPDATE purchase_receipts SET sync_txid = sync_txid WHERE sync_txid <> pg_current_xact_id()
                    AND id IN (SELECT document_id FROM purchase_receipt_lines WHERE id IN (%s))', receipt_lines);
            END IF;

            PERFORM set_config('keystone.sync_touch', coalesce(previous, ''), true);

            RETURN NULL;
        END;
        $$;

        CREATE TRIGGER sync_sources_insert AFTER INSERT ON purchase_return_lines REFERENCING NEW TABLE AS sync_new
            FOR EACH STATEMENT EXECUTE FUNCTION purchasing_sync_touch_sources();
        CREATE TRIGGER sync_sources_update AFTER UPDATE ON purchase_return_lines REFERENCING OLD TABLE AS sync_old NEW TABLE AS sync_new
            FOR EACH STATEMENT EXECUTE FUNCTION purchasing_sync_touch_sources();
        CREATE TRIGGER sync_sources_delete AFTER DELETE ON purchase_return_lines REFERENCING OLD TABLE AS sync_old
            FOR EACH STATEMENT EXECUTE FUNCTION purchasing_sync_touch_sources();
        CREATE TRIGGER sync_sources_status AFTER UPDATE ON purchase_returns REFERENCING OLD TABLE AS sync_old NEW TABLE AS sync_new
            FOR EACH STATEMENT EXECUTE FUNCTION purchasing_sync_touch_sources();
        CREATE TRIGGER sync_sources_insert AFTER INSERT ON purchase_invoice_lines REFERENCING NEW TABLE AS sync_new
            FOR EACH STATEMENT EXECUTE FUNCTION purchasing_sync_touch_sources();
        CREATE TRIGGER sync_sources_update AFTER UPDATE ON purchase_invoice_lines REFERENCING OLD TABLE AS sync_old NEW TABLE AS sync_new
            FOR EACH STATEMENT EXECUTE FUNCTION purchasing_sync_touch_sources();
        CREATE TRIGGER sync_sources_delete AFTER DELETE ON purchase_invoice_lines REFERENCING OLD TABLE AS sync_old
            FOR EACH STATEMENT EXECUTE FUNCTION purchasing_sync_touch_sources();
        CREATE TRIGGER sync_sources_status AFTER UPDATE ON purchase_invoices REFERENCING OLD TABLE AS sync_old NEW TABLE AS sync_new
            FOR EACH STATEMENT EXECUTE FUNCTION purchasing_sync_touch_sources();
        SQL;

    private const string SOURCES_DOWN = <<<'SQL'
        DROP TRIGGER IF EXISTS sync_sources_status ON purchase_invoices;
        DROP TRIGGER IF EXISTS sync_sources_delete ON purchase_invoice_lines;
        DROP TRIGGER IF EXISTS sync_sources_update ON purchase_invoice_lines;
        DROP TRIGGER IF EXISTS sync_sources_insert ON purchase_invoice_lines;
        DROP TRIGGER IF EXISTS sync_sources_status ON purchase_returns;
        DROP TRIGGER IF EXISTS sync_sources_delete ON purchase_return_lines;
        DROP TRIGGER IF EXISTS sync_sources_update ON purchase_return_lines;
        DROP TRIGGER IF EXISTS sync_sources_insert ON purchase_return_lines;
        DROP FUNCTION IF EXISTS purchasing_sync_touch_sources();
        SQL;

    /**
     * The KP003 guard, with (up) or without (down) the sync touch exemption.
     *
     * @return literal-string
     */
    private static function receiptsGuard(bool $exempt): string
    {
        $touch = $exempt
            ? "-- Only a sync touch that changes nothing but the sync position (SET sync_txid = sync_txid).\n"
              ."                IF TG_OP = 'UPDATE' AND sync_touching() AND (to_jsonb(NEW) - 'sync_txid') = (to_jsonb(OLD) - 'sync_txid') THEN\n"
              ."                    RETURN NEW;\n"
              .'                END IF;'
            : '';

        return <<<SQL
            CREATE OR REPLACE FUNCTION purchase_receipts_guard() RETURNS trigger LANGUAGE plpgsql AS \$\$
            DECLARE
                kept text[] := ARRAY['status', 'version', 'updated_at', 'cancelled_at', 'cancelled_by', 'cancel_reason',
                                     'reversal_stock_document_id', 'reversal_date'];
            BEGIN
                IF OLD.status = 'draft' THEN
                    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
                END IF;
                {$touch}
                IF TG_OP = 'UPDATE' AND OLD.status = 'posted' AND NEW.status = 'cancelled' AND NEW.cancelled_at IS NOT NULL
                   AND (to_jsonb(NEW) - kept) = (to_jsonb(OLD) - kept) THEN
                    RETURN NEW;
                END IF;
                RAISE EXCEPTION USING ERRCODE = 'KP003',
                    MESSAGE = format('purchase receipt %s is %s and cannot be changed', coalesce(OLD.number, OLD.id::text), OLD.status);
            END;
            \$\$;
            SQL;
    }

    public function up(): void
    {
        foreach (self::DOCUMENTS as $header => $lines) {
            Schema::table($header, static function (Blueprint $t): void {
                $t->syncable();
            });
            Schema::table($lines, static function (Blueprint $t) use ($header): void {
                $t->syncable(parent: $header, parentKey: ['document_id']);
            });
        }

        DB::unprepared(self::SOURCES_UP);
        DB::unprepared(self::receiptsGuard(true));
    }

    public function down(): void
    {
        DB::unprepared(self::receiptsGuard(false));
        DB::unprepared(self::SOURCES_DOWN);

        foreach (self::DOCUMENTS as $header => $lines) {
            Schema::table($lines, static function (Blueprint $t) use ($header): void {
                $t->dropSyncable(parent: $header);
            });
            Schema::table($header, static function (Blueprint $t): void {
                $t->dropSyncable();
            });
        }
    }
};
