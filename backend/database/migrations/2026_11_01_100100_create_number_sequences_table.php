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
        Schema::create('number_sequences', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            // FK to companies is added by the organization module once that table exists.
            $table->uuid('company_id');
            $table->string('doc_type', 64);
            $table->string('series', 16)->default('');
            $table->unsignedSmallInteger('fiscal_year');
            $table->unsignedBigInteger('last_value')->default(0);
            $table->string('format', 64)->nullable();
            $table->timestampsTz();

            $table->unique(['company_id', 'doc_type', 'series', 'fiscal_year']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('number_sequences');
    }
};
