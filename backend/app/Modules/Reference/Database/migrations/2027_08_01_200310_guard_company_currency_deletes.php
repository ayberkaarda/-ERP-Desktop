<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * KR001 company currency activations are only soft deleted.
 *
 * The currencies sync position is GREATEST(currencies.sync_txid, newest activation row of the
 * company and code, trashed included). A physically deleted activation would drop out of that
 * maximum, so the position would fall back to the global currency row and the change would
 * never reach the company's stream (the tombstone names the activation row, not the currency).
 * DELETE and TRUNCATE are therefore refused, and an activation keeps its company and code,
 * since moving it would strand the old pair in the same way. Deactivate or soft delete instead.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION ref_company_currencies_guard() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'UPDATE' THEN
                    IF NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.currency_code IS DISTINCT FROM OLD.currency_code THEN
                        RAISE EXCEPTION USING ERRCODE = 'KR001',
                            MESSAGE = 'company currency activations keep their company and currency';
                    END IF;
                    RETURN NEW;
                END IF;

                RAISE EXCEPTION USING ERRCODE = 'KR001',
                    MESSAGE = 'company currency activations are soft deleted only; deactivate or soft delete instead';
            END;
            $$;

            CREATE TRIGGER company_currencies_guard BEFORE UPDATE OR DELETE ON company_currencies
                FOR EACH ROW EXECUTE FUNCTION ref_company_currencies_guard();
            CREATE TRIGGER company_currencies_no_truncate BEFORE TRUNCATE ON company_currencies
                FOR EACH STATEMENT EXECUTE FUNCTION ref_company_currencies_guard();
            SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            DROP TRIGGER IF EXISTS company_currencies_no_truncate ON company_currencies;
            DROP TRIGGER IF EXISTS company_currencies_guard ON company_currencies;
            DROP FUNCTION IF EXISTS ref_company_currencies_guard();
            SQL);
    }
};
