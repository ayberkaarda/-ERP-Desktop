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
        Schema::create('price_lists', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id');
            $table->string('code', 32);
            $table->string('name', 200);
            $table->char('currency_code', 3);
            $table->boolean('is_default')->default(false);
            $table->date('valid_from')->nullable();
            $table->date('valid_to')->nullable();
            $table->boolean('is_active')->default(true);
            $table->boolean('tax_inclusive')->default(false);
            $table->unsignedInteger('version')->default(1);
            $table->timestampsTz();
            $table->softDeletesTz();

            $table->index(['company_id', 'currency_code']);
        });

        DB::statement('ALTER TABLE price_lists ADD CONSTRAINT price_lists_validity_check CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)');
        DB::statement('CREATE UNIQUE INDEX price_lists_company_code_unique ON price_lists (company_id, code) WHERE deleted_at IS NULL');
        // One default list per currency.
        DB::statement('CREATE UNIQUE INDEX price_lists_default_unique ON price_lists (company_id, currency_code) WHERE is_default AND deleted_at IS NULL');

        Schema::create('price_list_lines', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id');
            $table->uuid('price_list_id');
            $table->uuid('item_id');
            $table->uuid('variant_id')->nullable();
            $table->uuid('unit_id');
            $table->decimal('min_qty', 20, 6)->default(0);
            $table->decimal('price', 20, 6);
            $table->date('valid_from')->nullable();
            $table->date('valid_to')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestampsTz();

            $table->foreign('price_list_id')->references('id')->on('price_lists')->cascadeOnDelete();
            $table->foreign('item_id')->references('id')->on('items')->restrictOnDelete();
            $table->foreign('variant_id')->references('id')->on('item_variants')->restrictOnDelete();
            $table->foreign('unit_id')->references('id')->on('units')->restrictOnDelete();
            $table->index(['item_id']);
        });

        DB::statement('ALTER TABLE price_list_lines ADD CONSTRAINT price_list_lines_validity_check CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)');
        DB::statement('ALTER TABLE price_list_lines ADD CONSTRAINT price_list_lines_amounts_check CHECK (min_qty >= 0 AND price >= 0)');
        DB::statement('ALTER TABLE price_list_lines ADD CONSTRAINT price_list_lines_key_unique UNIQUE NULLS NOT DISTINCT (price_list_id, item_id, variant_id, unit_id, min_qty, valid_from)');

        Schema::create('discount_rules', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id');
            $table->string('code', 32);
            $table->string('name', 200);
            $table->string('scope', 16);
            $table->uuid('scope_ref')->nullable();
            // Parties module id (no cross-module foreign key).
            $table->uuid('party_id')->nullable();
            $table->decimal('min_qty', 20, 6)->default(0);
            $table->decimal('discount_percent', 7, 4);
            $table->integer('priority')->default(0);
            $table->boolean('stackable')->default(false);
            $table->date('valid_from')->nullable();
            $table->date('valid_to')->nullable();
            $table->boolean('is_active')->default(true);
            $table->unsignedInteger('version')->default(1);
            $table->timestampsTz();
            $table->softDeletesTz();

            $table->index(['company_id', 'is_active']);
        });

        DB::statement("ALTER TABLE discount_rules ADD CONSTRAINT discount_rules_scope_check CHECK (scope IN ('item', 'category', 'party', 'all'))");
        DB::statement('ALTER TABLE discount_rules ADD CONSTRAINT discount_rules_percent_check CHECK (discount_percent > 0 AND discount_percent <= 100)');
        DB::statement('ALTER TABLE discount_rules ADD CONSTRAINT discount_rules_validity_check CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)');
        DB::statement('CREATE UNIQUE INDEX discount_rules_company_code_unique ON discount_rules (company_id, code) WHERE deleted_at IS NULL');
    }

    public function down(): void
    {
        Schema::dropIfExists('discount_rules');
        Schema::dropIfExists('price_list_lines');
        Schema::dropIfExists('price_lists');
    }
};
