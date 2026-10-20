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
        Schema::create('files', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id');
            $table->string('disk', 40);
            // Server generated key; never derived from user input.
            $table->string('path', 500);
            $table->string('original_name', 255);
            $table->string('mime', 150);
            $table->unsignedBigInteger('size');
            $table->char('sha256', 64);
            $table->uuid('uploaded_by')->nullable();
            $table->string('attachable_type', 150)->nullable();
            $table->uuid('attachable_id')->nullable();
            $table->timestampsTz();
            $table->softDeletesTz();

            $table->index(['company_id', 'attachable_type', 'attachable_id']);
            $table->index(['company_id', 'sha256']);
            $table->unique(['disk', 'path']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('files');
    }
};
