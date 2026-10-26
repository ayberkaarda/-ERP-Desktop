<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('items', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id');
            $table->string('code', 64);
            $table->string('name', 255);
            $table->text('description')->nullable();
            $table->string('type', 16);
            $table->uuid('base_unit_id');
            $table->uuid('category_id')->nullable();
            // Reference module ids (no cross-module foreign keys).
            $table->uuid('default_tax_code_id')->nullable();
            $table->uuid('purchase_tax_code_id')->nullable();
            $table->string('tracking', 16)->default('none');
            $table->boolean('has_expiry')->default(false);
            $table->decimal('min_stock', 20, 6)->nullable();
            $table->decimal('reorder_point', 20, 6)->nullable();
            $table->boolean('is_active')->default(true);
            $table->jsonb('attributes')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestampsTz();
            $table->softDeletesTz();

            $table->foreign('base_unit_id')->references('id')->on('units')->restrictOnDelete();
            $table->foreign('category_id')->references('id')->on('item_categories')->restrictOnDelete();
            $table->index(['company_id', 'type']);
            $table->index(['company_id', 'category_id']);
        });

        DB::statement("ALTER TABLE items ADD CONSTRAINT items_type_check CHECK (type IN ('stock', 'service'))");
        DB::statement("ALTER TABLE items ADD CONSTRAINT items_tracking_check CHECK (tracking IN ('none', 'lot', 'serial'))");
        DB::statement('CREATE UNIQUE INDEX items_company_code_unique ON items (company_id, code) WHERE deleted_at IS NULL');
        DB::statement('CREATE INDEX items_name_trgm ON items USING gin (name gin_trgm_ops)');
        DB::statement('CREATE INDEX items_code_trgm ON items USING gin (code gin_trgm_ops)');

        Schema::create('item_variants', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id');
            $table->uuid('item_id');
            $table->string('sku', 64);
            $table->string('name', 255)->nullable();
            $table->jsonb('attributes')->nullable();
            $table->boolean('is_active')->default(true);
            $table->unsignedInteger('version')->default(1);
            $table->timestampsTz();
            $table->softDeletesTz();

            $table->foreign('item_id')->references('id')->on('items')->cascadeOnDelete();
            $table->index(['item_id']);
        });

        DB::statement('CREATE UNIQUE INDEX item_variants_company_sku_unique ON item_variants (company_id, sku) WHERE deleted_at IS NULL');
        DB::statement('CREATE INDEX item_variants_sku_trgm ON item_variants USING gin (sku gin_trgm_ops)');

        Schema::create('item_units', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id');
            $table->uuid('item_id');
            $table->uuid('unit_id');
            // 1 unit = factor base units of the item.
            $table->decimal('factor', 20, 6);
            $table->unsignedInteger('version')->default(1);
            $table->timestampsTz();

            $table->foreign('item_id')->references('id')->on('items')->cascadeOnDelete();
            $table->foreign('unit_id')->references('id')->on('units')->restrictOnDelete();
            $table->unique(['item_id', 'unit_id']);
        });

        DB::statement('ALTER TABLE item_units ADD CONSTRAINT item_units_factor_positive CHECK (factor > 0)');

        Schema::create('item_barcodes', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id');
            $table->uuid('item_id');
            $table->uuid('variant_id')->nullable();
            $table->uuid('unit_id');
            $table->string('barcode', 64);
            $table->string('type', 16)->default('other');
            $table->boolean('is_primary')->default(false);
            $table->unsignedInteger('version')->default(1);
            $table->timestampsTz();

            $table->foreign('item_id')->references('id')->on('items')->cascadeOnDelete();
            $table->foreign('variant_id')->references('id')->on('item_variants')->cascadeOnDelete();
            $table->foreign('unit_id')->references('id')->on('units')->restrictOnDelete();
            $table->unique(['company_id', 'barcode']);
            $table->index(['item_id']);
        });

        DB::statement('CREATE UNIQUE INDEX item_barcodes_primary_unique ON item_barcodes (item_id) WHERE is_primary');
        DB::statement('CREATE INDEX item_barcodes_barcode_trgm ON item_barcodes USING gin (barcode gin_trgm_ops)');
    }

    public function down(): void
    {
        Schema::dropIfExists('item_barcodes');
        Schema::dropIfExists('item_units');
        Schema::dropIfExists('item_variants');
        Schema::dropIfExists('items');
    }
};
