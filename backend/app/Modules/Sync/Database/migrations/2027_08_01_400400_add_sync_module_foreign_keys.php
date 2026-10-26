<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Cross-module keys of the Sync tables: generations, resolutions and full-download cursors go
 * with their user and company.
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (['sync_visibility_generations', 'sync_push_resolutions'] as $name) {
            Schema::table($name, function (Blueprint $table): void {
                $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
                $table->foreign('company_id')->references('id')->on('companies')->cascadeOnDelete();
            });
        }

        Schema::table('sync_full_downloads', function (Blueprint $table): void {
            $table->foreign('company_id')->references('id')->on('companies')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        foreach (['sync_visibility_generations', 'sync_push_resolutions'] as $name) {
            Schema::table($name, function (Blueprint $table): void {
                $table->dropForeign(['user_id']);
                $table->dropForeign(['company_id']);
            });
        }

        Schema::table('sync_full_downloads', function (Blueprint $table): void {
            $table->dropForeign(['company_id']);
        });
    }
};
