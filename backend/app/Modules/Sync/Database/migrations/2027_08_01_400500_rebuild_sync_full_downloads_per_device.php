<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
 * Full-download sessions keyed by the durable device (user_devices) instead of the access
 * token, one per device, company and resource. Rows of the old shape are only resumable
 * cursors: dropping them makes running downloads fall back to the position check.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::dropIfExists('sync_full_downloads');

        Schema::create('sync_full_downloads', function (Blueprint $table): void {
            $table->uuid('device_id');
            $table->uuid('user_id');
            $table->uuid('company_id');
            $table->string('resource', 80);
            $table->char('cursor_hash', 64);
            $table->char('previous_hash', 64)->nullable();
            $table->timestampTz('created_at')->index();
            $table->timestampTz('updated_at');

            $table->primary(['device_id', 'company_id', 'resource']);
            $table->foreign('device_id')->references('id')->on('user_devices')->cascadeOnDelete();
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->foreign('company_id')->references('id')->on('companies')->cascadeOnDelete();
        });

        DB::statement('ALTER TABLE sync_full_downloads ADD COLUMN started_horizon xid8 NOT NULL');
    }

    public function down(): void
    {
        Schema::dropIfExists('sync_full_downloads');

        Schema::create('sync_full_downloads', function (Blueprint $table): void {
            $table->char('cursor_hash', 64)->primary();
            $table->string('token_id', 64);
            $table->uuid('company_id');
            $table->string('resource', 80);
            $table->timestampTz('created_at')->index();
            $table->foreign('company_id')->references('id')->on('companies')->cascadeOnDelete();
        });

        DB::statement('ALTER TABLE sync_full_downloads ADD COLUMN started_horizon xid8 NOT NULL');
    }
};
