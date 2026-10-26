<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Purchasing invariants enforced by the database (SQLSTATE class KP):
 *  KP001 a booked supplier invoice (and a cancelled or reversed one) is immutable: only status moves
 *        along booked/partially_paid/paid/reversed, paid_amount, balance_due, the reversal stamp and
 *        the e-document fields may change; it is never deleted;
 *  KP002 lines of an invoice that left draft/pending approval are immutable;
 *  KP003 a posted goods receipt is immutable except the cancellation that reverses it; its lines
 *        never change.
 * Line guards read the parent under a share lock, so a line edit waits for a transaction holding the
 * parent (book, post) and then sees the status it committed. Positive quantities and unique numbers
 * are check constraints and unique indexes of the tables migration.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION purchase_invoices_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
                    OR (OLD.status = 'booked' AND NEW.status IN ('partially_paid', 'paid', 'reversed'))
                    OR (OLD.status = 'partially_paid' AND NEW.status IN ('booked', 'paid'))
                    OR (OLD.status = 'paid' AND NEW.status IN ('booked', 'partially_paid'))
                ) THEN
                    RETURN NEW;
                END IF;
                RAISE EXCEPTION USING ERRCODE = 'KP001',
                    MESSAGE = format('purchase invoice %s is %s and cannot be changed', coalesce(OLD.number, OLD.id::text), OLD.status);
            END;
            $$;

            CREATE TRIGGER purchase_invoices_guard BEFORE UPDATE OR DELETE ON purchase_invoices
                FOR EACH ROW EXECUTE FUNCTION purchase_invoices_guard();

            CREATE OR REPLACE FUNCTION purchase_invoice_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                doc uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.document_id ELSE NEW.document_id END;
                st text;
            BEGIN
                SELECT status INTO st FROM purchase_invoices WHERE id = doc FOR SHARE;
                -- A missing parent is a cascade from deleting a draft.
                IF NOT FOUND OR st IN ('draft', 'pending_approval') THEN
                    IF TG_OP = 'UPDATE' AND OLD.document_id <> NEW.document_id THEN
                        RAISE EXCEPTION USING ERRCODE = 'KP002', MESSAGE = 'an invoice line cannot move to another invoice';
                    END IF;
                    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
                END IF;
                RAISE EXCEPTION USING ERRCODE = 'KP002',
                    MESSAGE = format('lines of purchase invoice %s are immutable (%s)', doc, st);
            END;
            $$;

            CREATE TRIGGER purchase_invoice_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON purchase_invoice_lines
                FOR EACH ROW EXECUTE FUNCTION purchase_invoice_lines_guard();

            CREATE OR REPLACE FUNCTION purchase_receipts_guard() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                kept text[] := ARRAY['status', 'version', 'updated_at', 'cancelled_at', 'cancelled_by', 'cancel_reason',
                                     'reversal_stock_document_id', 'reversal_date'];
            BEGIN
                IF OLD.status = 'draft' THEN
                    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
                END IF;
                IF TG_OP = 'UPDATE' AND OLD.status = 'posted' AND NEW.status = 'cancelled' AND NEW.cancelled_at IS NOT NULL
                   AND (to_jsonb(NEW) - kept) = (to_jsonb(OLD) - kept) THEN
                    RETURN NEW;
                END IF;
                RAISE EXCEPTION USING ERRCODE = 'KP003',
                    MESSAGE = format('purchase receipt %s is %s and cannot be changed', coalesce(OLD.number, OLD.id::text), OLD.status);
            END;
            $$;

            CREATE TRIGGER purchase_receipts_guard BEFORE UPDATE OR DELETE ON purchase_receipts
                FOR EACH ROW EXECUTE FUNCTION purchase_receipts_guard();

            CREATE OR REPLACE FUNCTION purchase_receipt_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                doc uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.document_id ELSE NEW.document_id END;
                st text;
            BEGIN
                SELECT status INTO st FROM purchase_receipts WHERE id = doc FOR SHARE;
                IF NOT FOUND OR st = 'draft' THEN
                    IF TG_OP = 'UPDATE' AND OLD.document_id <> NEW.document_id THEN
                        RAISE EXCEPTION USING ERRCODE = 'KP003', MESSAGE = 'a receipt line cannot move to another receipt';
                    END IF;
                    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
                END IF;
                RAISE EXCEPTION USING ERRCODE = 'KP003',
                    MESSAGE = format('lines of purchase receipt %s are immutable (%s)', doc, st);
            END;
            $$;

            CREATE TRIGGER purchase_receipt_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON purchase_receipt_lines
                FOR EACH ROW EXECUTE FUNCTION purchase_receipt_lines_guard();
            SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            DROP TRIGGER IF EXISTS purchase_receipt_lines_guard ON purchase_receipt_lines;
            DROP TRIGGER IF EXISTS purchase_receipts_guard ON purchase_receipts;
            DROP TRIGGER IF EXISTS purchase_invoice_lines_guard ON purchase_invoice_lines;
            DROP TRIGGER IF EXISTS purchase_invoices_guard ON purchase_invoices;
            DROP FUNCTION IF EXISTS purchase_receipt_lines_guard();
            DROP FUNCTION IF EXISTS purchase_receipts_guard();
            DROP FUNCTION IF EXISTS purchase_invoice_lines_guard();
            DROP FUNCTION IF EXISTS purchase_invoices_guard();
            SQL);
    }
};
