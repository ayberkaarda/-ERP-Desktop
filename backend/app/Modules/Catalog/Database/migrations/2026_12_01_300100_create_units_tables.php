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
        DB::statement('CREATE EXTENSION IF NOT EXISTS pg_trgm');

        // company_id foreign keys to companies are added at integration (cross-module).
        Schema::create('units', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id');
            $table->string('code', 32);
            $table->string('name', 200);
            $table->string('symbol', 16)->nullable();
            $table->boolean('is_active')->default(true);
            $table->unsignedInteger('version')->default(1);
            $table->timestampsTz();
            $table->softDeletesTz();

            $table->index(['company_id', 'is_active']);
        });

        DB::statement('CREATE UNIQUE INDEX units_company_code_unique ON units (company_id, code) WHERE deleted_at IS NULL');

        Schema::create('unit_conversions', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id');
            $table->uuid('from_unit_id');
            $table->uuid('to_unit_id');
            // 1 from_unit = factor to_unit.
            $table->decimal('factor', 20, 6);
            $table->unsignedInteger('version')->default(1);
            $table->timestampsTz();

            $table->foreign('from_unit_id')->references('id')->on('units')->restrictOnDelete();
            $table->foreign('to_unit_id')->references('id')->on('units')->restrictOnDelete();
            $table->index(['company_id']);
        });

        DB::statement('ALTER TABLE unit_conversions ADD CONSTRAINT unit_conversions_factor_positive CHECK (factor > 0)');
        DB::statement('ALTER TABLE unit_conversions ADD CONSTRAINT unit_conversions_distinct_units CHECK (from_unit_id <> to_unit_id)');
        // One edge per unordered pair; the service additionally keeps the graph a forest.
        DB::statement('CREATE UNIQUE INDEX unit_conversions_pair_unique ON unit_conversions (company_id, LEAST(from_unit_id, to_unit_id), GREATEST(from_unit_id, to_unit_id))');
    }

    public function down(): void
    {
        Schema::dropIfExists('unit_conversions');
        Schema::dropIfExists('units');
    }
};
