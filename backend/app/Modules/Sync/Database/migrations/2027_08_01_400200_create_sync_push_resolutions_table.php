<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Conflict results that a later push mutation resolved (SYNC-PROTOCOL "Yerine geçme"): the
 * resolved key's idempotency scope hash and the key of the applied mutation that superseded
 * it. One resolution per conflict; rows live as long as push results (sync:prune).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sync_push_resolutions', function (Blueprint $table): void {
            $table->char('resolved_scope_hash', 64)->primary();
            $table->uuid('resolved_key');
            $table->uuid('superseded_by');
            $table->uuid('user_id');
            $table->uuid('company_id');
            $table->timestampTz('created_at')->index();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sync_push_resolutions');
    }
};
