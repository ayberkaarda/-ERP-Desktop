<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sync_cursor_scopes', function (Blueprint $table): void {
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignUuid('company_id')->constrained('companies')->cascadeOnDelete();
            $table->string('resource', 128);
            $table->char('position_hash', 64);
            $table->timestampTz('created_at')->useCurrent()->index();
            $table->primary(['user_id', 'company_id', 'resource', 'position_hash']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sync_cursor_scopes');
    }
};
