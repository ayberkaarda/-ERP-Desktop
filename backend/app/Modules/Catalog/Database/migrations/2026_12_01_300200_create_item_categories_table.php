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
        Schema::create('item_categories', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id');
            $table->uuid('parent_id')->nullable();
            $table->string('code', 32);
            $table->string('name', 200);
            // Materialized path of ancestor ids including self: "/<root>/.../<id>/".
            $table->text('path');
            $table->unsignedSmallInteger('depth');
            $table->boolean('is_active')->default(true);
            $table->unsignedInteger('version')->default(1);
            $table->timestampsTz();
            $table->softDeletesTz();

            $table->index(['company_id', 'parent_id']);
        });

        Schema::table('item_categories', function (Blueprint $table): void {
            $table->foreign('parent_id')->references('id')->on('item_categories')->restrictOnDelete();
        });

        DB::statement('CREATE UNIQUE INDEX item_categories_company_code_unique ON item_categories (company_id, code) WHERE deleted_at IS NULL');
        DB::statement('CREATE INDEX item_categories_path_index ON item_categories (company_id, path text_pattern_ops)');
        DB::statement('CREATE INDEX item_categories_name_trgm ON item_categories USING gin (name gin_trgm_ops)');
    }

    public function down(): void
    {
        Schema::dropIfExists('item_categories');
    }
};
