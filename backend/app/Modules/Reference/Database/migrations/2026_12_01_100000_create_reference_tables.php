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
        $tables = [
            'currencies' => function (Blueprint $t): void {
                $t->char('code', 3)->unique();
                $t->string('name');
                $t->string('symbol', 12);
                $t->unsignedSmallInteger('decimals')->default(2);
                $t->boolean('is_active')->default(true);
            },
            'company_currencies' => function (Blueprint $t): void {
                $t->uuid('company_id')->index();
                $t->char('currency_code', 3);
                $t->boolean('is_active')->default(true);
            },
            'exchange_rates' => function (Blueprint $t): void {
                // Null for global TCMB fixings; set for a company's manual rates.
                $t->uuid('company_id')->nullable()->index();
                $t->char('currency_code', 3);
                $t->date('rate_date');
                foreach (['forex_buying', 'forex_selling', 'banknote_buying', 'banknote_selling'] as $column) {
                    $t->decimal($column, 20, 6)->nullable();
                }
                $t->string('source', 12);
            },
            'tax_codes' => function (Blueprint $t): void {
                $t->uuid('company_id')->nullable()->index();
                $t->string('type', 20);
                $t->string('code', 40);
                $t->string('name');
                $t->decimal('rate', 7, 4)->nullable();
                $t->unsignedSmallInteger('numerator')->nullable();
                $t->unsignedSmallInteger('denominator')->nullable();
                $t->date('effective_from');
                $t->date('effective_to')->nullable();
                $t->boolean('is_active')->default(true);
                $t->jsonb('meta')->nullable();
            },
            'payment_terms' => function (Blueprint $t): void {
                $t->uuid('company_id')->index();
                $t->string('code', 40);
                $t->string('name');
                $t->unsignedInteger('due_days')->default(0);
                $t->decimal('discount_percent', 7, 4)->default(0);
                $t->unsignedInteger('discount_days')->default(0);
                $t->boolean('is_active')->default(true);
            },
            'warehouses' => function (Blueprint $t): void {
                $t->uuid('company_id')->index();
                $t->string('code', 40);
                $t->string('name');
                $t->uuid('branch_id')->nullable();
                $t->jsonb('address')->nullable();
                $t->boolean('is_active')->default(true);
                $t->string('negative_stock_policy', 12)->default('block');
                $t->boolean('is_default')->default(false);
            },
            'locations' => function (Blueprint $t): void {
                $t->uuid('company_id')->index();
                $t->foreignUuid('warehouse_id')->constrained('warehouses');
                $t->string('code', 40);
                $t->string('name');
                $t->uuid('parent_id')->nullable()->index();
                $t->string('type', 12);
                $t->boolean('is_active')->default(true);
                $t->string('barcode')->nullable();
            },
            'cost_centers' => function (Blueprint $t): void {
                $t->uuid('company_id')->index();
                $t->string('code', 40);
                $t->string('name');
                $t->uuid('parent_id')->nullable()->index();
                $t->boolean('is_active')->default(true);
            },
            'projects' => function (Blueprint $t): void {
                $t->uuid('company_id')->index();
                $t->string('code', 40);
                $t->string('name');
                $t->string('status', 16)->default('planned');
                $t->date('start_date')->nullable();
                $t->date('end_date')->nullable();
                $t->uuid('party_id')->nullable();
                $t->foreignUuid('cost_center_id')->nullable()->constrained('cost_centers');
            },
        ];
        foreach ($tables as $name => $columns) {
            Schema::create($name, function (Blueprint $table) use ($columns): void {
                $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
                $columns($table);
                $table->unsignedInteger('version')->default(1);
                $table->timestampsTz();
                $table->softDeletesTz();
            });
        }
        // Self references need the primary key to exist first.
        foreach (['locations', 'cost_centers'] as $table) {
            Schema::table($table, function (Blueprint $t) use ($table): void {
                $t->foreign('parent_id')->references('id')->on($table);
            });
        }
        foreach (['payment_terms', 'warehouses', 'cost_centers', 'projects'] as $table) {
            DB::statement("CREATE UNIQUE INDEX {$table}_live_code ON {$table} (company_id, code) WHERE deleted_at IS NULL");
        }
        DB::statement('CREATE UNIQUE INDEX locations_live_code ON locations (company_id, warehouse_id, code) WHERE deleted_at IS NULL');
        DB::statement('CREATE UNIQUE INDEX company_currencies_live_code ON company_currencies (company_id, currency_code) WHERE deleted_at IS NULL');
        DB::statement('CREATE UNIQUE INDEX warehouses_one_default ON warehouses (company_id) WHERE is_default AND deleted_at IS NULL');
        DB::statement('CREATE UNIQUE INDEX tax_codes_live_code ON tax_codes (company_id, code, effective_from) NULLS NOT DISTINCT WHERE deleted_at IS NULL');
        DB::statement("CREATE UNIQUE INDEX exchange_rates_tcmb_day ON exchange_rates (currency_code, rate_date) WHERE source = 'tcmb'");
        DB::statement("CREATE UNIQUE INDEX exchange_rates_manual_day ON exchange_rates (company_id, currency_code, rate_date) WHERE source = 'manual'");
        DB::statement("ALTER TABLE exchange_rates ADD CONSTRAINT exchange_rates_owner CHECK ((source = 'tcmb' AND company_id IS NULL) OR (source = 'manual' AND company_id IS NOT NULL))");
        DB::statement('ALTER TABLE tax_codes ADD CONSTRAINT tax_codes_fraction CHECK ((numerator IS NULL AND denominator IS NULL) OR (numerator IS NOT NULL AND denominator IS NOT NULL AND numerator > 0 AND denominator > 0 AND numerator <= denominator))');
        DB::statement('ALTER TABLE tax_codes ADD CONSTRAINT tax_codes_period CHECK (effective_to IS NULL OR effective_to >= effective_from)');
        DB::statement('ALTER TABLE projects ADD CONSTRAINT projects_period CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)');
    }

    public function down(): void
    {
        foreach (['projects', 'cost_centers', 'locations', 'warehouses', 'payment_terms', 'tax_codes', 'exchange_rates', 'company_currencies', 'currencies'] as $table) {
            Schema::dropIfExists($table);
        }
    }
};
