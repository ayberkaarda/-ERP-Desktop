<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The line guards (KS002, KS003) read the parent status under a share lock: a line edit waits for
 * a transaction that holds the parent row (issue, post) and then sees the status it committed, so
 * a line cannot change between the moment a posting read the lines and its commit.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION sales_invoice_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                doc uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.document_id ELSE NEW.document_id END;
                st text;
            BEGIN
                SELECT status INTO st FROM sales_invoices WHERE id = doc FOR SHARE;
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

            CREATE OR REPLACE FUNCTION sales_delivery_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                doc uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.document_id ELSE NEW.document_id END;
                st text;
            BEGIN
                SELECT status INTO st FROM sales_deliveries WHERE id = doc FOR SHARE;
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
            SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION sales_invoice_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                doc uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.document_id ELSE NEW.document_id END;
                st text;
            BEGIN
                SELECT status INTO st FROM sales_invoices WHERE id = doc;
                IF NOT FOUND OR st IN ('draft', 'pending_approval') THEN
                    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
                END IF;
                RAISE EXCEPTION USING ERRCODE = 'KS002', MESSAGE = format('lines of sales invoice %s are immutable (%s)', doc, st);
            END;
            $$;

            CREATE OR REPLACE FUNCTION sales_delivery_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                doc uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.document_id ELSE NEW.document_id END;
                st text;
            BEGIN
                SELECT status INTO st FROM sales_deliveries WHERE id = doc;
                IF NOT FOUND OR st = 'draft' THEN
                    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
                END IF;
                RAISE EXCEPTION USING ERRCODE = 'KS003', MESSAGE = format('lines of sales delivery %s are immutable (%s)', doc, st);
            END;
            $$;
            SQL);
    }
};
