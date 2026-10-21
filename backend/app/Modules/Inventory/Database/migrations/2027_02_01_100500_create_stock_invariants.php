<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Stock invariants enforced by the database, independent of application code:
 *  KI001 stock movements are append-only (no UPDATE, DELETE or TRUNCATE);
 *  KI002 on hand never ends a transaction below zero where the warehouse blocks negative stock
 *        (Reference warehouses.negative_stock_policy = block, or no warehouse row);
 *  KI003 serial units are created in stock and change status only along valid transitions;
 *  KI004 a movement's lot, serial and reversed movement belong to its company and item, and a
 *        reversal mirrors the movement it reverses;
 *  KI005 posted and cancelled stock documents and their lines are immutable, except the reversal
 *        that marks a posted document cancelled.
 * The single default warehouse per company is Reference's unique index warehouses_one_default.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION inv_movements_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                RAISE EXCEPTION USING ERRCODE = 'KI001',
                    MESSAGE = 'stock movements are append-only; post a reversing movement instead';
            END;
            $$;

            CREATE TRIGGER stock_movements_immutable BEFORE UPDATE OR DELETE ON stock_movements
                FOR EACH ROW EXECUTE FUNCTION inv_movements_immutable();
            CREATE TRIGGER stock_movements_no_truncate BEFORE TRUNCATE ON stock_movements
                FOR EACH STATEMENT EXECUTE FUNCTION inv_movements_immutable();

            CREATE OR REPLACE FUNCTION inv_balance_negative_check() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                qty numeric;
                policy text;
            BEGIN
                -- Deferred: judge the row as it stands at commit, not an intermediate state.
                SELECT on_hand INTO qty FROM stock_balances
                WHERE company_id = NEW.company_id AND item_id = NEW.item_id AND warehouse_id = NEW.warehouse_id
                  AND location_id = NEW.location_id AND lot_id = NEW.lot_id;
                IF NOT FOUND OR qty >= 0 THEN
                    RETURN NULL;
                END IF;

                SELECT negative_stock_policy INTO policy FROM warehouses
                WHERE id = NEW.warehouse_id AND company_id = NEW.company_id;
                IF policy IS NULL OR policy NOT IN ('allow', 'warn') THEN
                    RAISE EXCEPTION USING ERRCODE = 'KI002',
                        MESSAGE = format('stock of item %s in warehouse %s would become negative (%s)', NEW.item_id, NEW.warehouse_id, qty);
                END IF;
                RETURN NULL;
            END;
            $$;

            CREATE CONSTRAINT TRIGGER stock_balances_not_negative
                AFTER INSERT OR UPDATE ON stock_balances
                DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION inv_balance_negative_check();

            CREATE OR REPLACE FUNCTION inv_serial_transition() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'INSERT' THEN
                    IF NEW.status <> 'in_stock' THEN
                        RAISE EXCEPTION USING ERRCODE = 'KI003',
                            MESSAGE = format('serial %s must enter as in_stock, not %s', NEW.serial_no, NEW.status);
                    END IF;
                    RETURN NEW;
                END IF;

                IF NEW.company_id <> OLD.company_id OR NEW.item_id <> OLD.item_id OR NEW.serial_no <> OLD.serial_no THEN
                    RAISE EXCEPTION USING ERRCODE = 'KI003', MESSAGE = 'serial identity cannot change';
                END IF;

                IF NEW.status = OLD.status
                   OR (OLD.status = 'in_stock' AND NEW.status IN ('issued', 'reserved', 'scrapped'))
                   OR (OLD.status = 'reserved' AND NEW.status IN ('in_stock', 'issued'))
                   OR (OLD.status IN ('issued', 'scrapped') AND NEW.status = 'in_stock') THEN
                    RETURN NEW;
                END IF;

                RAISE EXCEPTION USING ERRCODE = 'KI003',
                    MESSAGE = format('serial %s cannot go from %s to %s', OLD.serial_no, OLD.status, NEW.status);
            END;
            $$;

            CREATE TRIGGER stock_serials_transition BEFORE INSERT OR UPDATE ON stock_serials
                FOR EACH ROW EXECUTE FUNCTION inv_serial_transition();

            CREATE OR REPLACE FUNCTION inv_movement_references() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                r record;
            BEGIN
                IF NEW.lot_id IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM stock_lots WHERE id = NEW.lot_id AND company_id = NEW.company_id AND item_id = NEW.item_id) THEN
                    RAISE EXCEPTION USING ERRCODE = 'KI004', MESSAGE = format('lot %s does not belong to item %s', NEW.lot_id, NEW.item_id);
                END IF;
                IF NEW.serial_id IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM stock_serials WHERE id = NEW.serial_id AND company_id = NEW.company_id AND item_id = NEW.item_id) THEN
                    RAISE EXCEPTION USING ERRCODE = 'KI004', MESSAGE = format('serial %s does not belong to item %s', NEW.serial_id, NEW.item_id);
                END IF;
                IF NEW.reverses_id IS NOT NULL THEN
                    SELECT company_id, item_id, warehouse_id, direction, quantity, total_cost INTO r
                    FROM stock_movements WHERE id = NEW.reverses_id;
                    IF NOT FOUND OR r.company_id <> NEW.company_id OR r.item_id <> NEW.item_id OR r.warehouse_id <> NEW.warehouse_id
                       OR r.direction = NEW.direction OR r.quantity <> NEW.quantity OR r.total_cost <> NEW.total_cost THEN
                        RAISE EXCEPTION USING ERRCODE = 'KI004', MESSAGE = format('movement does not mirror the movement %s it reverses', NEW.reverses_id);
                    END IF;
                END IF;
                RETURN NEW;
            END;
            $$;

            CREATE TRIGGER stock_movements_references BEFORE INSERT ON stock_movements
                FOR EACH ROW EXECUTE FUNCTION inv_movement_references();

            CREATE OR REPLACE FUNCTION inv_documents_guard() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                kept text[] := ARRAY['status', 'version', 'updated_at', 'reversal_date', 'reversal_reason',
                                     'reversal_journal_entry_id', 'reversed_at', 'reversed_by'];
            BEGIN
                IF OLD.status = 'draft' THEN
                    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
                END IF;
                IF TG_OP = 'UPDATE' AND OLD.status = 'posted' AND NEW.status = 'cancelled'
                   AND NEW.reversed_at IS NOT NULL AND (to_jsonb(NEW) - kept) = (to_jsonb(OLD) - kept) THEN
                    RETURN NEW;
                END IF;
                RAISE EXCEPTION USING ERRCODE = 'KI005',
                    MESSAGE = format('stock document %s is %s and cannot be changed', coalesce(OLD.number, OLD.id::text), OLD.status);
            END;
            $$;

            CREATE TRIGGER stock_documents_guard BEFORE UPDATE OR DELETE ON stock_documents
                FOR EACH ROW EXECUTE FUNCTION inv_documents_guard();

            CREATE OR REPLACE FUNCTION inv_document_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                doc uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.document_id ELSE NEW.document_id END;
                st text;
            BEGIN
                SELECT status INTO st FROM stock_documents WHERE id = doc;
                -- A missing parent is a cascade from deleting a draft.
                IF NOT FOUND OR st = 'draft' THEN
                    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
                END IF;
                RAISE EXCEPTION USING ERRCODE = 'KI005',
                    MESSAGE = format('lines of the %s stock document %s cannot be changed', st, doc);
            END;
            $$;

            CREATE TRIGGER stock_document_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON stock_document_lines
                FOR EACH ROW EXECUTE FUNCTION inv_document_lines_guard();
            SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            DROP TRIGGER IF EXISTS stock_document_lines_guard ON stock_document_lines;
            DROP TRIGGER IF EXISTS stock_documents_guard ON stock_documents;
            DROP TRIGGER IF EXISTS stock_movements_references ON stock_movements;
            DROP TRIGGER IF EXISTS stock_serials_transition ON stock_serials;
            DROP TRIGGER IF EXISTS stock_balances_not_negative ON stock_balances;
            DROP TRIGGER IF EXISTS stock_movements_no_truncate ON stock_movements;
            DROP TRIGGER IF EXISTS stock_movements_immutable ON stock_movements;
            DROP FUNCTION IF EXISTS inv_document_lines_guard();
            DROP FUNCTION IF EXISTS inv_documents_guard();
            DROP FUNCTION IF EXISTS inv_movement_references();
            DROP FUNCTION IF EXISTS inv_serial_transition();
            DROP FUNCTION IF EXISTS inv_balance_negative_check();
            DROP FUNCTION IF EXISTS inv_movements_immutable();
            SQL);
    }
};
