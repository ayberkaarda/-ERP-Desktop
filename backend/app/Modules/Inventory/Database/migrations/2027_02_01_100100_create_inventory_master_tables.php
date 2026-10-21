<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Warehouses and locations are Reference master data (tables warehouses, locations); inventory
 * keeps its own policy per warehouse, lots and serial units. Cross-module ids are plain uuids.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('stock_warehouse_settings', function (Blueprint $table): void {
            $table->uuid('warehouse_id')->primary();
            $table->uuid('company_id')->index();
            $table->string('reservation_policy', 8)->default('soft');
            $table->unsignedInteger('version')->default(1);
            $table->timestampsTz();
        });
        DB::statement("ALTER TABLE stock_warehouse_settings ADD CONSTRAINT stock_warehouse_settings_policy_check CHECK (reservation_policy IN ('none', 'soft', 'hard'))");

        Schema::create('stock_lots', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id');
            $table->uuid('item_id');
            $table->string('lot_no', 64);
            $table->date('expiry_date')->nullable();
            $table->date('manufacture_date')->nullable();
            $table->timestampsTz();

            $table->unique(['company_id', 'item_id', 'lot_no']);
            $table->index(['company_id', 'expiry_date']);
        });

        Schema::create('stock_serials', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id');
            $table->uuid('item_id');
            $table->string('serial_no', 100);
            $table->uuid('lot_id')->nullable();
            $table->string('status', 12);
            $table->uuid('warehouse_id')->nullable();
            $table->uuid('location_id')->nullable();
            $table->timestampsTz();

            $table->unique(['company_id', 'item_id', 'serial_no']);
            $table->index(['company_id', 'warehouse_id', 'status']);
            $table->foreign('lot_id')->references('id')->on('stock_lots')->restrictOnDelete();
        });
        DB::statement("ALTER TABLE stock_serials ADD CONSTRAINT stock_serials_status_check CHECK (status IN ('in_stock', 'issued', 'reserved', 'scrapped'))");
        // A unit in stock (or held for someone) is somewhere; one that left is nowhere.
        DB::statement("ALTER TABLE stock_serials ADD CONSTRAINT stock_serials_place_check CHECK ((status IN ('in_stock', 'reserved')) = (warehouse_id IS NOT NULL))");
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_serials');
        Schema::dropIfExists('stock_lots');
        Schema::dropIfExists('stock_warehouse_settings');
    }
};
