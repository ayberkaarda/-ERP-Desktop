<?php

declare(strict_types=1);

use App\Core\Sync\Schema\Syncable;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * KS005: sales orders get the database guard the other sales documents have, matching what
 * OrderService allows.
 *
 *  - draft: free;
 *  - pending_approval / confirmed that no delivery or invoice line references (any status, as
 *    OrderService::assertNoDocuments): free, so revision, approval and cancellation keep working;
 *  - any other order: the header only moves status, version, updated_at, closed_at and
 *    cancelled_at, a closed or cancelled one nothing at all, and none is deleted; lines only take
 *    delivered_quantity, invoiced_quantity and reservation_id (progress also follows reversals
 *    after the close), and no line is added, removed or moved.
 *
 * The sync parent touch of a line change passes through Syncable::GUARD_EXEMPTION. The line
 * guard reads the order status without a lock: the services that change order lines already
 * hold the order row (OrderProgress, OrderReservations), and a lock here would add a new wait.
 */
return new class extends Migration
{
    public function up(): void
    {
        $exemption = Syncable::GUARD_EXEMPTION;

        DB::unprepared(<<<SQL
            CREATE OR REPLACE FUNCTION sales_order_has_documents(order_id uuid) RETURNS boolean LANGUAGE sql STABLE AS \$\$
                SELECT EXISTS (SELECT 1 FROM sales_deliveries d WHERE d.order_id = \$1)
                    OR EXISTS (SELECT 1 FROM sales_invoice_lines l JOIN sales_order_lines o ON o.id = l.order_line_id WHERE o.document_id = \$1)
            \$\$;

            CREATE OR REPLACE FUNCTION sales_orders_guard() RETURNS trigger LANGUAGE plpgsql AS \$\$
            DECLARE
                kept text[] := ARRAY['status', 'version', 'updated_at', 'closed_at', 'cancelled_at'];
            BEGIN
                {$exemption}
                IF OLD.status = 'draft' THEN
                    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
                END IF;
                IF TG_OP = 'UPDATE' AND OLD.status IN ('pending_approval', 'confirmed') AND NOT sales_order_has_documents(OLD.id) THEN
                    RETURN NEW;
                END IF;
                IF TG_OP = 'UPDATE' AND OLD.status NOT IN ('closed', 'cancelled')
                   AND (to_jsonb(NEW) - kept) = (to_jsonb(OLD) - kept) THEN
                    RETURN NEW;
                END IF;
                RAISE EXCEPTION USING ERRCODE = 'KS005',
                    MESSAGE = format('sales order %s is %s and cannot be changed', coalesce(OLD.number, OLD.id::text), OLD.status);
            END;
            \$\$;

            CREATE TRIGGER sales_orders_guard BEFORE UPDATE OR DELETE ON sales_orders
                FOR EACH ROW EXECUTE FUNCTION sales_orders_guard();

            CREATE OR REPLACE FUNCTION sales_order_lines_guard() RETURNS trigger LANGUAGE plpgsql AS \$\$
            DECLARE
                doc uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.document_id ELSE NEW.document_id END;
                progress text[] := ARRAY['delivered_quantity', 'invoiced_quantity', 'reservation_id'];
                st text;
            BEGIN
                SELECT status INTO st FROM sales_orders WHERE id = doc;
                -- A missing parent is a cascade from deleting a draft.
                IF NOT FOUND OR st = 'draft' OR (st IN ('pending_approval', 'confirmed') AND NOT sales_order_has_documents(doc)) THEN
                    IF TG_OP = 'UPDATE' AND OLD.document_id <> NEW.document_id THEN
                        RAISE EXCEPTION USING ERRCODE = 'KS005', MESSAGE = 'an order line cannot move to another order';
                    END IF;
                    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
                END IF;
                IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - progress) = (to_jsonb(OLD) - progress) THEN
                    RETURN NEW;
                END IF;
                RAISE EXCEPTION USING ERRCODE = 'KS005',
                    MESSAGE = format('lines of sales order %s are immutable (%s)', doc, st);
            END;
            \$\$;

            CREATE TRIGGER sales_order_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON sales_order_lines
                FOR EACH ROW EXECUTE FUNCTION sales_order_lines_guard();
            SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            DROP TRIGGER IF EXISTS sales_order_lines_guard ON sales_order_lines;
            DROP TRIGGER IF EXISTS sales_orders_guard ON sales_orders;
            DROP FUNCTION IF EXISTS sales_order_lines_guard();
            DROP FUNCTION IF EXISTS sales_orders_guard();
            DROP FUNCTION IF EXISTS sales_order_has_documents(uuid);
            SQL);
    }
};
