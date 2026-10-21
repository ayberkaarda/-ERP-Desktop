<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * company_id, payment_term_id, price_list_id and the currency codes point at other modules and
 * carry no foreign keys here (added at integration).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('CREATE EXTENSION IF NOT EXISTS pg_trgm');

        Schema::create('parties', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id')->index();
            $table->string('code', 32);
            $table->string('name', 255);
            $table->string('legal_name', 255)->nullable();
            $table->string('type', 16);
            $table->jsonb('roles');
            $table->string('tax_office', 100)->nullable();
            $table->string('tax_number', 32)->nullable();
            $table->char('country', 2)->default('TR');
            $table->char('default_currency_code', 3)->nullable();
            $table->uuid('payment_term_id')->nullable();
            $table->uuid('price_list_id')->nullable();
            $table->decimal('risk_limit', 20, 4)->nullable();
            $table->char('risk_currency_code', 3)->nullable();
            $table->boolean('is_active')->default(true);
            $table->text('notes')->nullable();
            $table->jsonb('tags')->default(DB::raw("'[]'::jsonb"));
            $table->unsignedInteger('version')->default(1);
            $table->timestampsTz();
            $table->softDeletesTz();
        });

        DB::statement("ALTER TABLE parties ADD CONSTRAINT parties_type_check CHECK (type IN ('company', 'person'))");
        DB::statement("ALTER TABLE parties ADD CONSTRAINT parties_roles_check CHECK (jsonb_typeof(roles) = 'array' AND jsonb_array_length(roles) >= 1 AND roles <@ '[\"customer\", \"supplier\"]'::jsonb)");
        DB::statement("ALTER TABLE parties ADD CONSTRAINT parties_tags_check CHECK (jsonb_typeof(tags) = 'array')");
        DB::statement('ALTER TABLE parties ADD CONSTRAINT parties_risk_limit_check CHECK (risk_limit IS NULL OR risk_limit >= 0)');

        DB::statement('CREATE UNIQUE INDEX parties_company_code_unique ON parties (company_id, code) WHERE deleted_at IS NULL');
        // Inactive or deleted parties may share a tax number with the one active record.
        DB::statement('CREATE UNIQUE INDEX parties_company_tax_number_unique ON parties (company_id, tax_number) WHERE deleted_at IS NULL AND is_active AND tax_number IS NOT NULL');
        DB::statement('CREATE INDEX parties_company_tax_number_index ON parties (company_id, tax_number)');
        DB::statement('CREATE INDEX parties_roles_gin ON parties USING gin (roles jsonb_path_ops)');

        foreach (['name', 'legal_name', 'code', 'tax_number'] as $column) {
            DB::statement("CREATE INDEX parties_{$column}_trgm ON parties USING gin ({$column} gin_trgm_ops)");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('parties');
    }
};
