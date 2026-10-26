<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Visibility generation per (user, company, resource) (SYNC-PROTOCOL "Görünürlük nesli").
 * `state` is the last observed visibility of the resource for the user; whenever an observation
 * differs from it the generation goes up by one. It never goes down and is never consumed:
 * every device compares its own cursor.gen with it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sync_visibility_generations', function (Blueprint $table): void {
            $table->uuid('user_id');
            $table->uuid('company_id');
            $table->string('resource', 80);
            $table->unsignedInteger('generation')->default(0);
            $table->string('state', 64);
            $table->timestampTz('updated_at');

            $table->primary(['user_id', 'company_id', 'resource']);
            $table->index('company_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sync_visibility_generations');
    }
};
