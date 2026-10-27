<?php

declare(strict_types=1);

use App\Core\Sync\Schema\Syncable;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        $exemption = Syncable::GUARD_EXEMPTION;
        DB::unprepared(<<<SQL
            CREATE OR REPLACE FUNCTION sales_order_has_active_documents(order_id uuid) RETURNS boolean LANGUAGE sql STABLE AS \$\$
                SELECT EXISTS (SELECT 1 FROM sales_deliveries d WHERE d.order_id = \$1 AND d.status IN ('draft', 'posted'))
                    OR EXISTS (SELECT 1 FROM sales_invoice_lines l
                        JOIN sales_order_lines o ON o.id = l.order_line_id
                        JOIN sales_invoices i ON i.id = l.document_id
                        WHERE o.document_id = \$1 AND i.status NOT IN ('cancelled', 'reversed'))
            \$\$;

            CREATE OR REPLACE FUNCTION sales_order_progress_status(order_id uuid) RETURNS text LANGUAGE sql STABLE AS \$\$
                SELECT CASE
                    WHEN count(*) > 0 AND bool_and(invoiced_quantity >= quantity) THEN 'invoiced'
                    WHEN bool_or(invoiced_quantity > 0) THEN 'partially_invoiced'
                    WHEN count(*) FILTER (WHERE item_type = 'stock') > 0
                        AND bool_and(delivered_quantity >= quantity) FILTER (WHERE item_type = 'stock') THEN 'delivered'
                    WHEN bool_or(delivered_quantity > 0) THEN 'partially_delivered'
                    ELSE 'confirmed' END
                FROM sales_order_lines WHERE document_id = \$1
            \$\$;
            CREATE OR REPLACE FUNCTION sales_orders_guard() RETURNS trigger LANGUAGE plpgsql AS \$\$
            DECLARE
                kept text[] := ARRAY['status', 'version', 'updated_at', 'closed_at', 'cancelled_at'];
                progress text[] := ARRAY['confirmed', 'partially_delivered', 'delivered', 'partially_invoiced', 'invoiced'];
            BEGIN
                {$exemption}
                IF OLD.status = 'draft' THEN
                    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
                END IF;
                IF TG_OP = 'UPDATE' AND OLD.status IN ('pending_approval', 'confirmed') AND NOT sales_order_has_documents(OLD.id) THEN
                    RETURN NEW;
                END IF;
                IF TG_OP = 'UPDATE' AND OLD.status NOT IN ('closed', 'cancelled')
                   AND (to_jsonb(NEW) - kept) = (to_jsonb(OLD) - kept)
                   AND (NEW.status = OLD.status
                        OR (OLD.status = ANY (progress) AND ((NEW.status = ANY (progress) AND NEW.status = sales_order_progress_status(OLD.id)) OR NEW.status = 'closed'))
                        OR (OLD.status = 'confirmed' AND NEW.status = 'cancelled' AND NOT sales_order_has_active_documents(OLD.id))) THEN
                    RETURN NEW;
                END IF;
                RAISE EXCEPTION USING ERRCODE = 'KS005',
                    MESSAGE = format('sales order %s is %s and cannot be changed', coalesce(OLD.number, OLD.id::text), OLD.status);
            END;
            \$\$;

            SQL);
    }

    public function down(): void
    {
        $exemption = Syncable::GUARD_EXEMPTION;
        DB::unprepared(<<<SQL
            CREATE OR REPLACE FUNCTION sales_orders_guard() RETURNS trigger LANGUAGE plpgsql AS \$\$
            DECLARE
                kept text[] := ARRAY['status', 'version', 'updated_at', 'closed_at', 'cancelled_at'];
                progress text[] := ARRAY['confirmed', 'partially_delivered', 'delivered', 'partially_invoiced', 'invoiced'];
            BEGIN
                {$exemption}
                IF OLD.status = 'draft' THEN
                    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
                END IF;
                IF TG_OP = 'UPDATE' AND OLD.status IN ('pending_approval', 'confirmed') AND NOT sales_order_has_documents(OLD.id) THEN
                    RETURN NEW;
                END IF;
                IF TG_OP = 'UPDATE' AND OLD.status NOT IN ('closed', 'cancelled')
                   AND (to_jsonb(NEW) - kept) = (to_jsonb(OLD) - kept)
                   AND (NEW.status = OLD.status
                        OR (OLD.status = ANY (progress) AND (NEW.status = ANY (progress) OR NEW.status = 'closed'))
                        OR (OLD.status = 'confirmed' AND NEW.status = 'cancelled')) THEN
                    RETURN NEW;
                END IF;
                RAISE EXCEPTION USING ERRCODE = 'KS005',
                    MESSAGE = format('sales order %s is %s and cannot be changed', coalesce(OLD.number, OLD.id::text), OLD.status);
            END;
            \$\$;

            DROP FUNCTION IF EXISTS sales_order_progress_status(uuid);
            DROP FUNCTION IF EXISTS sales_order_has_active_documents(uuid);
            SQL);
    }
};
