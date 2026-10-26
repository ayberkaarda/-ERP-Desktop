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
                )
                UPDATE items i SET sync_txid = sync_txid
                WHERE i.sync_txid <> pg_current_xact_id()
                  AND (
                    EXISTS (SELECT 1 FROM changed c WHERE c.id = i.base_unit_id AND c.company_id = i.company_id)
                    OR EXISTS (
                        SELECT 1 FROM item_units iu JOIN changed c ON c.id = iu.unit_id AND c.company_id = iu.company_id
                        WHERE iu.item_id = i.id AND iu.company_id = i.company_id
                    )
                  );

                WITH changed AS (
                    SELECT n.id, c.company_id
                    FROM sync_new n JOIN sync_old o ON o.id = n.id
                    CROSS JOIN LATERAL (VALUES (n.company_id), (o.company_id)) AS c (company_id)
                    WHERE (n.company_id, n.code, n.deleted_at) IS DISTINCT FROM (o.company_id, o.code, o.deleted_at)
                )
                UPDATE unit_conversions uc SET sync_txid = sync_txid
                WHERE uc.sync_txid <> pg_current_xact_id()
                  AND EXISTS (SELECT 1 FROM changed c WHERE c.company_id = uc.company_id AND c.id IN (uc.from_unit_id, uc.to_unit_id));

                PERFORM set_config('keystone.sync_touch', coalesce(previous, ''), true);

                RETURN NULL;
            END;
            $$;

            CREATE OR REPLACE FUNCTION catalog_sync_touch_category_embedders() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                previous text := current_setting('keystone.sync_touch', true);
            BEGIN
                PERFORM set_config('keystone.sync_touch', 'on', true);

                UPDATE items i SET sync_txid = sync_txid
                WHERE i.sync_txid <> pg_current_xact_id()
                  AND EXISTS (
                    SELECT 1 FROM sync_new n JOIN sync_old o ON o.id = n.id
                    WHERE (n.company_id, n.code, n.name, n.deleted_at) IS DISTINCT FROM (o.company_id, o.code, o.name, o.deleted_at)
                      AND i.category_id = n.id AND i.company_id IN (n.company_id, o.company_id)
                  );

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
