<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Continuation cursors issued while paging a full download, with the horizon the download
 * started at (App\Modules\Sync\Services\FullDownloads). Pruned by sync:prune.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sync_full_downloads', function (Blueprint $table): void {
            $table->char('cursor_hash', 64)->primary();
            $table->string('token_id', 64);
            $table->uuid('company_id');
            $table->string('resource', 80);
            $table->timestampTz('created_at')->index();
        });

        DB::statement('ALTER TABLE sync_full_downloads ADD COLUMN started_horizon xid8 NOT NULL');
    }

    public function down(): void
    {
        Schema::dropIfExists('sync_full_downloads');
    }
};
