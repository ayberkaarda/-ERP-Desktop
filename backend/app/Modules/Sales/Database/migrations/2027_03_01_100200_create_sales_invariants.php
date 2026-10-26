<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Sales invariants enforced by the database (SQLSTATE class KS):
 *  KS001 an issued invoice (and a cancelled or reversed one) is immutable: only status moves along
 *        issued/partially_paid/paid/reversed, paid_amount, balance_due, the reversal stamp and the
 *        e-document fields may change; it is never deleted;
 *  KS002 lines of an invoice that left draft are immutable;
 *  KS003 a posted delivery is immutable except the cancellation that reverses it; its lines never change;
 *  KS004 line quantities are positive and document numbers unique (check constraints and unique
 *        indexes of the tables migration).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION sales_invoices_guard() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                kept text[] := ARRAY['status', 'paid_amount', 'balance_due', 'version', 'updated_at', 'reversed_at', 'reversed_by',
                                     'reversal_date', 'reversal_reason', 'reversal_journal_entry_id', 'e_document_status', 'e_document_uuid'];
            BEGIN
                IF OLD.status IN ('draft', 'pending_approval') THEN
                    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
                END IF;
                IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - kept) = (to_jsonb(OLD) - kept) AND (
                       NEW.status = OLD.status AND OLD.status NOT IN ('cancelled', 'reversed')
                    OR (NEW.status = OLD.status AND NEW.paid_amount = OLD.paid_amount AND NEW.balance_due = OLD.balance_due
                        AND NEW.reversed_at IS NOT DISTINCT FROM OLD.reversed_at)
                    OR (OLD.status = 'issued' AND NEW.status IN ('partially_paid', 'paid', 'reversed'))
                    OR (OLD.status = 'partially_paid' AND NEW.status IN ('issued', 'paid'))
                    OR (OLD.status = 'paid' AND NEW.status IN ('issued', 'partially_paid'))
                ) THEN
                    RETURN NEW;
                END IF;
                RAISE EXCEPTION USING ERRCODE = 'KS001',
                    MESSAGE = format('sales invoice %s is %s and cannot be changed', coalesce(OLD.number, OLD.id::text), OLD.status);
            END;
            $$;

            CREATE TRIGGER sales_invoices_guard BEFORE UPDATE OR DELETE ON sales_invoices
                FOR EACH ROW EXECUTE FUNCTION sales_invoices_guard();

            CREATE OR REPLACE FUNCTION sales_invoice_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                doc uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.document_id ELSE NEW.document_id END;
                st text;
            BEGIN
                SELECT status INTO st FROM sales_invoices WHERE id = doc;
                -- A missing parent is a cascade from deleting a draft.
                IF NOT FOUND OR st IN ('draft', 'pending_approval') THEN
                    IF TG_OP = 'UPDATE' AND OLD.document_id <> NEW.document_id THEN
                        RAISE EXCEPTION USING ERRCODE = 'KS002', MESSAGE = 'an invoice line cannot move to another invoice';
                    END IF;
                    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
                END IF;
                RAISE EXCEPTION USING ERRCODE = 'KS002',
                    MESSAGE = format('lines of sales invoice %s are immutable (%s)', doc, st);
            END;
            $$;

            CREATE TRIGGER sales_invoice_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON sales_invoice_lines
                FOR EACH ROW EXECUTE FUNCTION sales_invoice_lines_guard();

            CREATE OR REPLACE FUNCTION sales_deliveries_guard() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                kept text[] := ARRAY['status', 'version', 'updated_at', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'reversal_stock_document_id'];
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

            CREATE TRIGGER sales_deliveries_guard BEFORE UPDATE OR DELETE ON sales_deliveries
                FOR EACH ROW EXECUTE FUNCTION sales_deliveries_guard();

            CREATE OR REPLACE FUNCTION sales_delivery_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                doc uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.document_id ELSE NEW.document_id END;
                st text;
            BEGIN
                SELECT status INTO st FROM sales_deliveries WHERE id = doc;
                IF NOT FOUND OR st = 'draft' THEN
                    IF TG_OP = 'UPDATE' AND OLD.document_id <> NEW.document_id THEN
                        RAISE EXCEPTION USING ERRCODE = 'KS003', MESSAGE = 'a delivery line cannot move to another delivery';
                    END IF;
                    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
                END IF;
                RAISE EXCEPTION USING ERRCODE = 'KS003',
                    MESSAGE = format('lines of sales delivery %s are immutable (%s)', doc, st);
            END;
            $$;

            CREATE TRIGGER sales_delivery_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON sales_delivery_lines
                FOR EACH ROW EXECUTE FUNCTION sales_delivery_lines_guard();
            SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            DROP TRIGGER IF EXISTS sales_delivery_lines_guard ON sales_delivery_lines;
            DROP TRIGGER IF EXISTS sales_deliveries_guard ON sales_deliveries;
            DROP TRIGGER IF EXISTS sales_invoice_lines_guard ON sales_invoice_lines;
            DROP TRIGGER IF EXISTS sales_invoices_guard ON sales_invoices;
            DROP FUNCTION IF EXISTS sales_delivery_lines_guard();
            DROP FUNCTION IF EXISTS sales_deliveries_guard();
            DROP FUNCTION IF EXISTS sales_invoice_lines_guard();
            DROP FUNCTION IF EXISTS sales_invoices_guard();
            SQL);
    }
};
