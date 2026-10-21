<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Ledger invariants enforced by the database, independent of application code:
 *  KA001 a booked (posted or reversed) entry balances and matches its totals, checked at commit;
 *  KA002 booked entries and their lines are immutable, except posted -> reversed;
 *  KA003 booking needs an open period (soft-closed only with keystone.allow_soft_closed) of an open year;
 *  KA004 lines use postable accounts of the company, and used accounts stay postable and undeleted;
 *  KA005 the entry date lies inside the entry's period of the same company and fiscal year.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION acc_check_entry_balance(p_entry uuid) RETURNS void LANGUAGE plpgsql AS $$
            DECLARE
                e record;
                d numeric;
                c numeric;
                n int;
                marker text := 'acc.balanced_' || replace(p_entry::text, '-', '');
            BEGIN
                -- Booked lines and totals can no longer change, so one check per entry and transaction suffices.
                IF current_setting(marker, true) = '1' THEN
                    RETURN;
                END IF;

                SELECT status, total_debit, total_credit INTO e FROM journal_entries WHERE id = p_entry;
                IF NOT FOUND OR e.status = 'draft' THEN
                    RETURN;
                END IF;

                SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) INTO d, c, n
                FROM journal_lines WHERE entry_id = p_entry;

                IF n = 0 OR d = 0 OR d <> c OR d <> e.total_debit OR c <> e.total_credit THEN
                    RAISE EXCEPTION USING ERRCODE = 'KA001',
                        MESSAGE = format('journal entry %s is not balanced: debit %s, credit %s, totals %s/%s', p_entry, d, c, e.total_debit, e.total_credit);
                END IF;

                PERFORM set_config(marker, '1', true);
            END;
            $$;

            CREATE OR REPLACE FUNCTION acc_lines_balance_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP IN ('UPDATE', 'DELETE') THEN
                    PERFORM acc_check_entry_balance(OLD.entry_id);
                END IF;
                IF TG_OP IN ('INSERT', 'UPDATE') THEN
                    PERFORM acc_check_entry_balance(NEW.entry_id);
                END IF;
                RETURN NULL;
            END;
            $$;

            CREATE OR REPLACE FUNCTION acc_entries_balance_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                PERFORM acc_check_entry_balance(NEW.id);
                RETURN NULL;
            END;
            $$;

            CREATE CONSTRAINT TRIGGER journal_lines_balanced
                AFTER INSERT OR UPDATE OR DELETE ON journal_lines
                DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION acc_lines_balance_trigger();

            CREATE CONSTRAINT TRIGGER journal_entries_balanced
                AFTER INSERT OR UPDATE ON journal_entries
                DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION acc_entries_balance_trigger();

            CREATE OR REPLACE FUNCTION acc_entries_guard() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                p record;
                y record;
                frozen text[] := ARRAY['status', 'reversed_by_id', 'version', 'updated_at'];
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    IF OLD.status <> 'draft' THEN
                        RAISE EXCEPTION USING ERRCODE = 'KA002',
                            MESSAGE = format('journal entry %s is %s and cannot be deleted; reverse it instead', coalesce(OLD.number, OLD.id::text), OLD.status);
                    END IF;
                    RETURN OLD;
                END IF;

                IF TG_OP = 'UPDATE' AND OLD.status <> 'draft' THEN
                    IF OLD.status = 'posted' AND NEW.status = 'reversed'
                       AND NEW.reversed_by_id IS NOT NULL
                       AND NEW.version = OLD.version + 1
                       AND (to_jsonb(NEW) - frozen) = (to_jsonb(OLD) - frozen)
                       AND EXISTS (SELECT 1 FROM journal_entries r
                                   WHERE r.id = NEW.reversed_by_id AND r.reverses_id = NEW.id AND r.status = 'posted') THEN
                        RETURN NEW;
                    END IF;
                    RAISE EXCEPTION USING ERRCODE = 'KA002',
                        MESSAGE = format('journal entry %s is %s and cannot be changed; only a reversal may mark it reversed', coalesce(OLD.number, OLD.id::text), OLD.status);
                END IF;

                IF NEW.status = 'reversed' THEN
                    RAISE EXCEPTION USING ERRCODE = 'KA002',
                        MESSAGE = 'only a posted journal entry can become reversed';
                END IF;

                SELECT id, company_id, fiscal_year_id, start_date, end_date, status INTO p
                FROM accounting_periods WHERE id = NEW.period_id FOR SHARE;
                IF NOT FOUND OR p.company_id <> NEW.company_id OR p.fiscal_year_id <> NEW.fiscal_year_id THEN
                    RAISE EXCEPTION USING ERRCODE = 'KA005',
                        MESSAGE = format('period %s does not belong to the company and fiscal year of the entry', NEW.period_id);
                END IF;
                IF NEW.entry_date < p.start_date OR NEW.entry_date > p.end_date THEN
                    RAISE EXCEPTION USING ERRCODE = 'KA005',
                        MESSAGE = format('entry date %s is outside its period %s..%s', NEW.entry_date, p.start_date, p.end_date);
                END IF;

                IF NEW.status = 'posted' THEN
                    -- Row locks make a concurrent period or year close wait for this transaction (and vice versa).
                    SELECT status INTO y FROM fiscal_years WHERE id = p.fiscal_year_id FOR SHARE;
                    IF y.status <> 'open' THEN
                        RAISE EXCEPTION USING ERRCODE = 'KA003',
                            MESSAGE = format('fiscal year of %s is closed', NEW.entry_date);
                    END IF;
                    IF p.status = 'closed'
                       OR (p.status = 'soft_closed' AND coalesce(current_setting('keystone.allow_soft_closed', true), '') <> 'on') THEN
                        RAISE EXCEPTION USING ERRCODE = 'KA003',
                            MESSAGE = format('accounting period %s..%s is %s', p.start_date, p.end_date, p.status);
                    END IF;
                    IF EXISTS (SELECT 1 FROM journal_lines l JOIN accounts a ON a.id = l.account_id
                               WHERE l.entry_id = NEW.id AND (NOT a.is_postable OR a.company_id <> NEW.company_id)) THEN
                        RAISE EXCEPTION USING ERRCODE = 'KA004',
                            MESSAGE = format('journal entry %s uses accounts that are not postable', NEW.id);
                    END IF;
                END IF;

                RETURN NEW;
            END;
            $$;

            CREATE TRIGGER journal_entries_guard BEFORE INSERT OR UPDATE OR DELETE ON journal_entries
                FOR EACH ROW EXECUTE FUNCTION acc_entries_guard();

            CREATE OR REPLACE FUNCTION acc_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                e record;
                a record;
            BEGIN
                IF TG_OP IN ('UPDATE', 'DELETE') THEN
                    SELECT status, number INTO e FROM journal_entries WHERE id = OLD.entry_id;
                    -- Not found: the entry itself is being deleted (only drafts can be).
                    IF FOUND AND e.status <> 'draft' THEN
                        RAISE EXCEPTION USING ERRCODE = 'KA002',
                            MESSAGE = format('lines of journal entry %s are immutable once it is %s', coalesce(e.number, OLD.entry_id::text), e.status);
                    END IF;
                    IF TG_OP = 'DELETE' THEN
                        RETURN OLD;
                    END IF;
                END IF;

                SELECT status, number, company_id INTO e FROM journal_entries WHERE id = NEW.entry_id FOR SHARE;
                IF NOT FOUND OR e.status <> 'draft' THEN
                    RAISE EXCEPTION USING ERRCODE = 'KA002',
                        MESSAGE = format('lines can only be written to draft journal entries (%s)', coalesce(e.number, NEW.entry_id::text));
                END IF;
                IF e.company_id <> NEW.company_id THEN
                    RAISE EXCEPTION USING ERRCODE = 'KA004', MESSAGE = 'journal line and entry belong to different companies';
                END IF;

                SELECT is_postable, company_id, code INTO a FROM accounts WHERE id = NEW.account_id FOR SHARE;
                IF NOT FOUND OR a.company_id <> NEW.company_id OR NOT a.is_postable THEN
                    RAISE EXCEPTION USING ERRCODE = 'KA004',
                        MESSAGE = format('account %s is not a postable account of the company', coalesce(a.code, NEW.account_id::text));
                END IF;

                RETURN NEW;
            END;
            $$;

            CREATE TRIGGER journal_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON journal_lines
                FOR EACH ROW EXECUTE FUNCTION acc_lines_guard();

            CREATE OR REPLACE FUNCTION acc_accounts_usage_guard() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    IF EXISTS (SELECT 1 FROM journal_lines WHERE account_id = OLD.id) THEN
                        RAISE EXCEPTION USING ERRCODE = 'KA004',
                            MESSAGE = format('account %s is used in journal lines and cannot be deleted', OLD.code);
                    END IF;
                    RETURN OLD;
                END IF;

                IF OLD.is_postable AND NOT NEW.is_postable AND EXISTS (
                    SELECT 1 FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
                    WHERE l.account_id = OLD.id AND e.status <> 'draft'
                ) THEN
                    RAISE EXCEPTION USING ERRCODE = 'KA004',
                        MESSAGE = format('account %s has posted lines and must stay postable', OLD.code);
                END IF;

                RETURN NEW;
            END;
            $$;

            CREATE TRIGGER accounts_usage_guard BEFORE UPDATE OF is_postable OR DELETE ON accounts
                FOR EACH ROW EXECUTE FUNCTION acc_accounts_usage_guard();
            SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            DROP TRIGGER IF EXISTS accounts_usage_guard ON accounts;
            DROP TRIGGER IF EXISTS journal_lines_guard ON journal_lines;
            DROP TRIGGER IF EXISTS journal_entries_guard ON journal_entries;
            DROP TRIGGER IF EXISTS journal_entries_balanced ON journal_entries;
            DROP TRIGGER IF EXISTS journal_lines_balanced ON journal_lines;
            DROP FUNCTION IF EXISTS acc_accounts_usage_guard();
            DROP FUNCTION IF EXISTS acc_lines_guard();
            DROP FUNCTION IF EXISTS acc_entries_guard();
            DROP FUNCTION IF EXISTS acc_entries_balance_trigger();
            DROP FUNCTION IF EXISTS acc_lines_balance_trigger();
            DROP FUNCTION IF EXISTS acc_check_entry_balance(uuid);
            SQL);
    }
};
