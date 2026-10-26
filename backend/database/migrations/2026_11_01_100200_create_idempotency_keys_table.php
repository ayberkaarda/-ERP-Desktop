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
        Schema::create('idempotency_keys', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            // sha256 of user + company + key, so keys never collide across tenants.
            $table->char('scope_hash', 64)->unique();
            $table->string('key', 255);
            $table->string('user_id', 64)->nullable();
            $table->uuid('company_id')->nullable();
            $table->string('method', 10);
            $table->string('path', 2048);
            $table->char('request_hash', 64);
            $table->string('status', 16);
            // Short lease for an in-flight claim; a retry may take over once it has passed.
            $table->timestampTz('lease_expires_at')->nullable();
            $table->unsignedSmallInteger('response_status')->nullable();
            $table->jsonb('response_headers')->nullable();
            $table->text('response_body')->nullable();
            $table->timestampTz('expires_at')->index();
            $table->timestampsTz();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('idempotency_keys');
    }
};
