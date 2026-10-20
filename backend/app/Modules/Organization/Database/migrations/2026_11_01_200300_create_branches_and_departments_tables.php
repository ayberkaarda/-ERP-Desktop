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
        Schema::create('branches', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id');
            $table->string('code', 32);
            $table->string('name', 200);
            $table->string('phone', 32)->nullable();
            $table->text('address')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestampsTz();
            $table->softDeletesTz();

            $table->unique(['company_id', 'code']);
            $table->foreign('company_id')->references('id')->on('companies')->cascadeOnDelete();
        });

        Schema::create('departments', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id');
            $table->uuid('branch_id')->nullable();
            $table->uuid('parent_id')->nullable();
            $table->uuid('manager_user_id')->nullable();
            $table->string('code', 32);
            $table->string('name', 200);
            $table->boolean('is_active')->default(true);
            $table->timestampsTz();
            $table->softDeletesTz();

            $table->unique(['company_id', 'code']);
            $table->foreign('company_id')->references('id')->on('companies')->cascadeOnDelete();
            $table->foreign('branch_id')->references('id')->on('branches')->nullOnDelete();
            $table->foreign('manager_user_id')->references('id')->on('users')->nullOnDelete();
        });

        // Self reference needs the primary key, which the create statement adds after inline foreign keys.
        Schema::table('departments', function (Blueprint $table): void {
            $table->foreign('parent_id')->references('id')->on('departments')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('departments');
        Schema::dropIfExists('branches');
    }
};
