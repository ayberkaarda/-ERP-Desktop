<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * KP001 tightened: the reversal stamp (reversed_at/by, reversal_date, reversal_reason,
 * reversal_journal_entry_id) is written only by the booked -> reversed transition; afterwards (and
 * on any other change) it is as immutable as the rest of the invoice.
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
                stamp_changed boolean;
            BEGIN
                IF OLD.status IN ('draft', 'pending_approval') THEN
                    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
                END IF;
                IF TG_OP = 'UPDATE' THEN
                    stamp_changed := ROW(NEW.reversed_at, NEW.reversed_by, NEW.reversal_date, NEW.reversal_reason, NEW.reversal_journal_entry_id)
                        IS DISTINCT FROM ROW(OLD.reversed_at, OLD.reversed_by, OLD.reversal_date, OLD.reversal_reason, OLD.reversal_journal_entry_id);
                    IF (to_jsonb(NEW) - kept) = (to_jsonb(OLD) - kept)
                       AND (NOT stamp_changed OR (OLD.status = 'booked' AND NEW.status = 'reversed'))
                       AND (
                           NEW.status = OLD.status AND OLD.status NOT IN ('cancelled', 'reversed')
                        OR (NEW.status = OLD.status AND NEW.paid_amount = OLD.paid_amount AND NEW.balance_due = OLD.balance_due)
                        OR (OLD.status = 'booked' AND NEW.status IN ('partially_paid', 'paid', 'reversed'))
                        OR (OLD.status = 'partially_paid' AND NEW.status IN ('booked', 'paid'))
                        OR (OLD.status = 'paid' AND NEW.status IN ('booked', 'partially_paid'))
                    ) THEN
                        RETURN NEW;
                    END IF;
                END IF;
                RAISE EXCEPTION USING ERRCODE = 'KP001',
                    MESSAGE = format('purchase invoice %s is %s and cannot be changed', coalesce(OLD.number, OLD.id::text), OLD.status);
            END;
            $$;
            SQL);
    }

    public function down(): void
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
            SQL);
    }
};
