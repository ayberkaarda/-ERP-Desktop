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
        // Rotating refresh tokens of desktop devices; only the sha256 of the token is stored.
        Schema::create('device_refresh_tokens', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('device_id');
            $table->char('token_hash', 64)->unique();
            $table->uuid('family_id');
            // users.auth_version at issue time; a bump (password, 2FA) invalidates the family.
            $table->unsignedInteger('auth_version');
            $table->timestampTz('expires_at');
            $table->timestampTz('used_at')->nullable();
            $table->timestampsTz();

            $table->index('device_id');
            $table->foreign('device_id')->references('id')->on('user_devices')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('device_refresh_tokens');
    }
};
