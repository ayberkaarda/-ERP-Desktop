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
        Schema::create('account_determination_rules', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id');
            $table->string('event_key', 100);
            $table->integer('priority')->default(0);
            $table->jsonb('conditions')->default(DB::raw("'{}'::jsonb"));
            $table->uuid('account_id');
            $table->string('side', 8)->nullable();
            $table->string('description', 500)->nullable();
            $table->boolean('is_system')->default(false);
            $table->boolean('is_active')->default(true);
            $table->unsignedInteger('version')->default(1);
            $table->timestampsTz();

            $table->index(['company_id', 'event_key', 'priority']);
            $table->foreign('account_id')->references('id')->on('accounts')->restrictOnDelete();
        });

        DB::statement("ALTER TABLE account_determination_rules ADD CONSTRAINT account_determination_rules_side_check CHECK (side IS NULL OR side IN ('debit', 'credit'))");
        DB::statement("ALTER TABLE account_determination_rules ADD CONSTRAINT account_determination_rules_conditions_check CHECK (jsonb_typeof(conditions) = 'object')");
        // One seeded default per event, so bootstrapping twice cannot duplicate it.
        DB::statement('CREATE UNIQUE INDEX account_determination_rules_system_unique ON account_determination_rules (company_id, event_key) WHERE is_system');
    }

    public function down(): void
    {
        Schema::dropIfExists('account_determination_rules');
    }
};
