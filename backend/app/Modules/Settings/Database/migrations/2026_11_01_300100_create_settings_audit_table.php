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
        Schema::create('settings_audit', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id');
            $table->string('key', 150);
            $table->uuid('actor_id')->nullable();
            $table->string('action', 10);
            // Sensitive settings are stored as the literal "[redacted]".
            $table->jsonb('old_value_redacted')->nullable();
            $table->jsonb('new_value_redacted')->nullable();
            $table->timestampTz('created_at')->useCurrent();

            $table->index(['company_id', 'key', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('settings_audit');
    }
};
