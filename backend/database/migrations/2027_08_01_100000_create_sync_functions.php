<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/*
 * Trigger functions behind the `syncable()` Blueprint macro (App\Core\Sync\Schema\Syncable).
 * Tables only bind triggers to these; the functions themselves live here once.
 *
 * - sync_touch: every insert/update stamps sync_txid with the writing transaction's xid8.
 * - sync_tombstone: a hard delete or a soft delete (deleted_at NULL -> set) upserts one
 *   sync_tombstones row per (table, id); a restore (deleted_at set -> NULL) removes it.
 *   Optional argument: the column holding the parent id, copied into the tombstone.
 * - sync_touch_parent: statement-level, over transition tables, so a child statement touches
 *   each affected parent once. Arguments: parent table, child columns, parent columns
 *   (comma separated, matched as a row value). Touches sync_txid only; version and
 *   updated_at stay untouched, so optimistic locking on the parent is not disturbed.
 *   The UPDATE itself writes sync_txid = sync_txid; the parent's own zz_sync_touch trigger
 *   stamps the value, and the statement runs with sync_touching() = true.
 * - sync_touching(): true inside such a parent touch. The flag alone proves nothing (any session
 *   can set it): row guards that refuse any change to a closed record (posted documents, ledgers)
 *   let the touch through only with sync_touch_only(OLD, NEW) from 2027_08_01_100300 (flag AND no
 *   column but sync_txid changed), i.e. App\Core\Sync\Schema\Syncable::GUARD_EXEMPTION.
 *
 * Guard compatibility: the macro names its stamping trigger zz_sync_touch, and PostgreSQL
 * runs BEFORE triggers in name order, so existing guards that compare to_jsonb(OLD) and
 * to_jsonb(NEW) see sync_txid unchanged on ordinary updates.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION sync_touch() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                NEW.sync_txid := pg_current_xact_id();
                RETURN NEW;
            END;
            $$;

            CREATE OR REPLACE FUNCTION sync_tombstone() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                parent_column text := NULLIF(TG_ARGV[0], '');
                row_data jsonb;
                tomb_reason text;
                tomb_at timestamptz;
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    row_data := to_jsonb(OLD);
                    tomb_reason := 'deleted';
                    tomb_at := now();
                ELSIF (to_jsonb(OLD) ->> 'deleted_at') IS NULL AND (to_jsonb(NEW) ->> 'deleted_at') IS NOT NULL THEN
                    row_data := to_jsonb(NEW);
                    tomb_reason := 'soft_deleted';
                    tomb_at := (row_data ->> 'deleted_at')::timestamptz;
                ELSIF (to_jsonb(OLD) ->> 'deleted_at') IS NOT NULL AND (to_jsonb(NEW) ->> 'deleted_at') IS NULL THEN
                    -- Restored: the live row (touched by sync_touch) supersedes the tombstone.
                    DELETE FROM sync_tombstones
                        WHERE resource_table = TG_TABLE_NAME AND row_id = (to_jsonb(NEW) ->> 'id')::uuid;
                    RETURN NULL;
                ELSE
                    RETURN NULL;
                END IF;

                INSERT INTO sync_tombstones (resource_table, row_id, company_id, parent_id, sync_txid, reason, deleted_at)
                VALUES (
                    TG_TABLE_NAME,
                    (row_data ->> 'id')::uuid,
                    (row_data ->> 'company_id')::uuid,
                    CASE WHEN parent_column IS NULL THEN NULL ELSE (row_data ->> parent_column)::uuid END,
                    pg_current_xact_id(),
                    tomb_reason,
                    tomb_at
                )
                ON CONFLICT (resource_table, row_id) DO UPDATE SET
                    company_id = EXCLUDED.company_id,
                    parent_id = EXCLUDED.parent_id,
                    sync_txid = EXCLUDED.sync_txid,
                    reason = EXCLUDED.reason,
                    deleted_at = EXCLUDED.deleted_at;

                RETURN NULL;
            END;
            $$;

            CREATE OR REPLACE FUNCTION sync_touch_parent() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                child_cols text;
                parent_cols text;
                source text;
                previous text;
            BEGIN
                SELECT string_agg(quote_ident(btrim(c)), ', ') INTO child_cols FROM unnest(string_to_array(TG_ARGV[1], ',')) AS c;
                SELECT string_agg(quote_ident(btrim(c)), ', ') INTO parent_cols FROM unnest(string_to_array(TG_ARGV[2], ',')) AS c;

                source := CASE TG_OP
                    WHEN 'INSERT' THEN format('SELECT %s FROM sync_new', child_cols)
                    WHEN 'DELETE' THEN format('SELECT %s FROM sync_old', child_cols)
                    ELSE format('SELECT %1$s FROM sync_new UNION SELECT %1$s FROM sync_old', child_cols)
                END;

                previous := current_setting('keystone.sync_touch', true);
                PERFORM set_config('keystone.sync_touch', 'on', true);

                EXECUTE format(
                    'UPDATE %I SET sync_txid = sync_txid WHERE (%s) IN (%s) AND sync_txid <> pg_current_xact_id()',
                    TG_ARGV[0], parent_cols, source
                );

                PERFORM set_config('keystone.sync_touch', coalesce(previous, ''), true);

                RETURN NULL;
            END;
            $$;

            CREATE OR REPLACE FUNCTION sync_touching() RETURNS boolean LANGUAGE sql STABLE AS $$
                SELECT coalesce(current_setting('keystone.sync_touch', true), '') = 'on'
            $$;
            SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            DROP FUNCTION IF EXISTS sync_touching();
            DROP FUNCTION IF EXISTS sync_touch_parent();
            DROP FUNCTION IF EXISTS sync_tombstone();
            DROP FUNCTION IF EXISTS sync_touch();
            SQL);
    }
};
