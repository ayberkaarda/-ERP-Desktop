<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Makes the offline catalog resources visible to sync pull.
 *
 * Own position and tombstones: items, item_variants, item_barcodes, item_categories, units,
 * unit_conversions, price_lists, price_list_lines. A child row change also touches its parent
 * (variants, barcodes, item_units -> items; price_list_lines -> price_lists), because the
 * parent's REST shape embeds or summarises them. item_units is only an embed of items, so it
 * has no position of its own.
 *
 * Embedded references: items embed their base unit, category and item_units' units, and
 * unit_conversions embed their two units. A change to an embedded field (or a soft delete,
 * which turns the embed into null) of a unit or category touches the embedding rows of the
 * same company: only sync_txid moves (their own zz_sync_touch stamps it), version and
 * updated_at stay, and the touch runs with sync_touching() = true like a parent touch.
 *
 * None of these tables has a BEFORE UPDATE guard trigger, so the touches need no
 * sync_touching() exception.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('units', fn (Blueprint $table) => $table->syncable());
        Schema::table('unit_conversions', fn (Blueprint $table) => $table->syncable());
        Schema::table('item_categories', fn (Blueprint $table) => $table->syncable());
        Schema::table('items', fn (Blueprint $table) => $table->syncable());
        Schema::table('item_variants', fn (Blueprint $table) => $table->syncable(parent: 'items', parentKey: ['item_id'], tracked: true));
        Schema::table('item_barcodes', fn (Blueprint $table) => $table->syncable(parent: 'items', parentKey: ['item_id'], tracked: true));
        Schema::table('item_units', fn (Blueprint $table) => $table->syncable(parent: 'items', parentKey: ['item_id']));
        Schema::table('price_lists', fn (Blueprint $table) => $table->syncable());
        Schema::table('price_list_lines', fn (Blueprint $table) => $table->syncable(parent: 'price_lists', parentKey: ['price_list_id'], tracked: true));

        // Reverse lookups for the embed touches below (company first, then the referenced id).
        DB::statement('CREATE INDEX items_company_base_unit_index ON items (company_id, base_unit_id)');
        DB::statement('CREATE INDEX item_units_company_unit_index ON item_units (company_id, unit_id)');
        DB::statement('CREATE INDEX unit_conversions_company_from_unit_index ON unit_conversions (company_id, from_unit_id)');
        DB::statement('CREATE INDEX unit_conversions_company_to_unit_index ON unit_conversions (company_id, to_unit_id)');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION catalog_sync_touch_unit_embedders() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                previous text := current_setting('keystone.sync_touch', true);
            BEGIN
                PERFORM set_config('keystone.sync_touch', 'on', true);

                WITH changed AS (
                    SELECT n.id, c.company_id
                    FROM sync_new n JOIN sync_old o ON o.id = n.id
                    CROSS JOIN LATERAL (VALUES (n.company_id), (o.company_id)) AS c (company_id)
                    WHERE (n.company_id, n.code, n.name, n.symbol, n.deleted_at) IS DISTINCT FROM (o.company_id, o.code, o.name, o.symbol, o.deleted_at)
                ), affected AS (
                    SELECT i.id, i.company_id FROM items i JOIN changed c ON i.company_id = c.company_id AND i.base_unit_id = c.id
                    UNION
                    SELECT iu.item_id, iu.company_id FROM item_units iu JOIN changed c ON iu.company_id = c.company_id AND iu.unit_id = c.id
                ), locked AS MATERIALIZED (
                    -- Lock the narrowed target set in the same order for every embed touch.
                    SELECT i.id, i.company_id FROM items i
                    JOIN affected a ON i.id = a.id AND i.company_id = a.company_id
                    ORDER BY i.id FOR NO KEY UPDATE OF i
                )
                UPDATE items i SET sync_txid = sync_txid
                FROM locked a
                WHERE i.id = a.id AND i.company_id = a.company_id AND i.sync_txid <> pg_current_xact_id();

                WITH changed AS (
                    SELECT n.id, c.company_id
                    FROM sync_new n JOIN sync_old o ON o.id = n.id
                    CROSS JOIN LATERAL (VALUES (n.company_id), (o.company_id)) AS c (company_id)
                    WHERE (n.company_id, n.code, n.deleted_at) IS DISTINCT FROM (o.company_id, o.code, o.deleted_at)
                ), affected AS (
                    SELECT uc.id FROM unit_conversions uc JOIN changed c ON uc.company_id = c.company_id AND uc.from_unit_id = c.id
                    UNION
                    SELECT uc.id FROM unit_conversions uc JOIN changed c ON uc.company_id = c.company_id AND uc.to_unit_id = c.id
                ), locked AS MATERIALIZED (
                    SELECT uc.id FROM unit_conversions uc
                    WHERE uc.id IN (SELECT id FROM affected)
                    ORDER BY uc.id FOR NO KEY UPDATE OF uc
                )
                UPDATE unit_conversions uc SET sync_txid = sync_txid
                FROM locked a
                WHERE uc.id = a.id AND uc.sync_txid <> pg_current_xact_id();

                PERFORM set_config('keystone.sync_touch', coalesce(previous, ''), true);

                RETURN NULL;
            END;
            $$;

            CREATE OR REPLACE FUNCTION catalog_sync_touch_category_embedders() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                previous text := current_setting('keystone.sync_touch', true);
            BEGIN
                PERFORM set_config('keystone.sync_touch', 'on', true);

                -- items (company_id, category_id) is indexed by the items migration.
                WITH changed AS (
                    SELECT DISTINCT n.id, c.company_id
                    FROM sync_new n JOIN sync_old o ON o.id = n.id
                    CROSS JOIN LATERAL (VALUES (n.company_id), (o.company_id)) AS c (company_id)
                    WHERE (n.company_id, n.code, n.name, n.deleted_at) IS DISTINCT FROM (o.company_id, o.code, o.name, o.deleted_at)
                ), affected AS (
                    SELECT i.id FROM items i JOIN changed c ON i.company_id = c.company_id AND i.category_id = c.id
                ), locked AS MATERIALIZED (
                    SELECT i.id FROM items i
                    WHERE i.id IN (SELECT id FROM affected)
                    ORDER BY i.id FOR NO KEY UPDATE OF i
                )
                UPDATE items i SET sync_txid = sync_txid
                FROM locked a
                WHERE i.id = a.id AND i.sync_txid <> pg_current_xact_id();

                PERFORM set_config('keystone.sync_touch', coalesce(previous, ''), true);

                RETURN NULL;
            END;
            $$;

            CREATE TRIGGER catalog_sync_touch_embedders AFTER UPDATE ON units
                REFERENCING OLD TABLE AS sync_old NEW TABLE AS sync_new
                FOR EACH STATEMENT EXECUTE FUNCTION catalog_sync_touch_unit_embedders();

            CREATE TRIGGER catalog_sync_touch_embedders AFTER UPDATE ON item_categories
                REFERENCING OLD TABLE AS sync_old NEW TABLE AS sync_new
                FOR EACH STATEMENT EXECUTE FUNCTION catalog_sync_touch_category_embedders();
            SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            DROP TRIGGER IF EXISTS catalog_sync_touch_embedders ON item_categories;
            DROP TRIGGER IF EXISTS catalog_sync_touch_embedders ON units;
            DROP FUNCTION IF EXISTS catalog_sync_touch_category_embedders();
            DROP FUNCTION IF EXISTS catalog_sync_touch_unit_embedders();
            DROP INDEX IF EXISTS unit_conversions_company_to_unit_index;
            DROP INDEX IF EXISTS unit_conversions_company_from_unit_index;
            DROP INDEX IF EXISTS item_units_company_unit_index;
            DROP INDEX IF EXISTS items_company_base_unit_index;
            SQL);

        Schema::table('price_list_lines', fn (Blueprint $table) => $table->dropSyncable(parent: 'price_lists', tracked: true));
        Schema::table('price_lists', fn (Blueprint $table) => $table->dropSyncable());
        Schema::table('item_units', fn (Blueprint $table) => $table->dropSyncable(parent: 'items'));
        Schema::table('item_barcodes', fn (Blueprint $table) => $table->dropSyncable(parent: 'items', tracked: true));
        Schema::table('item_variants', fn (Blueprint $table) => $table->dropSyncable(parent: 'items', tracked: true));
        Schema::table('items', fn (Blueprint $table) => $table->dropSyncable());
        Schema::table('item_categories', fn (Blueprint $table) => $table->dropSyncable());
        Schema::table('unit_conversions', fn (Blueprint $table) => $table->dropSyncable());
        Schema::table('units', fn (Blueprint $table) => $table->dropSyncable());
    }
};
