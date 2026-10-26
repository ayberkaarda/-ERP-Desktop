<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
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
 * None of these tables has a BEFORE UPDATE guard trigger, so the parent touch needs no
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
    }

    public function down(): void
    {
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
