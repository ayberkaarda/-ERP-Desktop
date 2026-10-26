<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/*
 * Each full-download session gets its own id, so continuation writes compare the session they
 * read (compare-and-swap) and never touch a session started after it.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE sync_full_downloads ADD COLUMN session_id uuid NOT NULL DEFAULT uuidv7()');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE sync_full_downloads DROP COLUMN session_id');
    }
};
