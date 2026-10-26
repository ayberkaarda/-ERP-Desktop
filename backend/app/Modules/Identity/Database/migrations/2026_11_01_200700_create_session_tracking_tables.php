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
        // One row per live browser session; the raw session id never leaves the server.
        Schema::create('user_sessions', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('user_id');
            $table->char('session_hash', 64)->unique();
            $table->text('session_id_encrypted');
            $table->string('ip_address', 45)->nullable();
            $table->string('user_agent', 512)->nullable();
            $table->timestampTz('last_active_at');
            $table->timestampsTz();

            $table->index(['user_id', 'last_active_at']);
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
        });

        Schema::create('user_devices', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('user_id');
            $table->uuid('token_id')->nullable();
            $table->string('name', 120);
            $table->char('fingerprint_hash', 64);
            $table->string('ip_address', 45)->nullable();
            $table->string('user_agent', 512)->nullable();
            $table->timestampTz('last_used_at')->nullable();
            $table->timestampTz('expires_at');
            $table->timestampsTz();

            $table->unique(['user_id', 'fingerprint_hash']);
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->foreign('token_id')->references('id')->on('personal_access_tokens')->nullOnDelete();
        });

        Schema::create('session_logs', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('user_id')->nullable();
            $table->string('email', 254)->nullable();
            $table->string('event', 32);
            $table->string('ip_address', 45)->nullable();
            $table->string('user_agent', 512)->nullable();
            $table->timestampTz('created_at');

            $table->index(['user_id', 'created_at']);
            $table->index(['event', 'created_at']);
            $table->foreign('user_id')->references('id')->on('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('session_logs');
        Schema::dropIfExists('user_devices');
        Schema::dropIfExists('user_sessions');
    }
};
