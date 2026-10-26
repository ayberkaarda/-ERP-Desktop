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
        Schema::create('companies', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->string('code', 32)->unique();
            $table->string('name', 200);
            $table->string('legal_name', 300)->nullable();
            $table->string('tax_number', 32)->nullable();
            $table->string('tax_office', 100)->nullable();
            $table->string('email', 254)->nullable();
            $table->string('phone', 32)->nullable();
            $table->text('address')->nullable();
            $table->char('country_code', 2)->default('TR');
            $table->char('base_currency', 3)->default('TRY');
            $table->string('timezone', 64)->default('Europe/Istanbul');
            $table->string('locale', 5)->default('tr');
            $table->boolean('is_active')->default(true);
            $table->timestampsTz();
            $table->softDeletesTz();
        });

        DB::statement('CREATE INDEX companies_name_trgm ON companies USING gin (name gin_trgm_ops)');

        Schema::create('company_user', function (Blueprint $table): void {
            $table->uuid('company_id');
            $table->uuid('user_id');
            $table->boolean('is_active')->default(true);
            $table->timestampsTz();

            $table->primary(['company_id', 'user_id']);
            $table->index('user_id');
            $table->foreign('company_id')->references('id')->on('companies')->cascadeOnDelete();
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('company_user');
        Schema::dropIfExists('companies');
    }
};
