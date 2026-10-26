<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/*
 * Version of a full-download session: every write of a session is a compare-and-swap on
 * (session_id, version), so requests that read an older state change nothing.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE sync_full_downloads ADD COLUMN version integer NOT NULL DEFAULT 1');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE sync_full_downloads DROP COLUMN version');
    }
};
