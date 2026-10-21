<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Addresses, contacts and bank accounts of a party. Rows are removed for real (the audit log keeps
 * the history); the party itself is soft deleted. Partial unique indexes back the
 * one-default-per-group rule that the service enforces under the party row lock.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('party_addresses', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id')->index();
            $table->foreignUuid('party_id')->constrained('parties')->cascadeOnDelete();
            $table->string('type', 16);
            $table->string('label', 100)->nullable();
            $table->string('line1', 255);
            $table->string('line2', 255)->nullable();
            $table->string('district', 100)->nullable();
            $table->string('city', 100)->nullable();
            $table->string('postal_code', 20)->nullable();
            $table->char('country', 2);
            $table->boolean('is_default')->default(false);
            $table->unsignedInteger('version')->default(1);
            $table->timestampsTz();
        });
        DB::statement("ALTER TABLE party_addresses ADD CONSTRAINT party_addresses_type_check CHECK (type IN ('billing', 'shipping', 'other'))");
        DB::statement('CREATE UNIQUE INDEX party_addresses_default_unique ON party_addresses (party_id, type) WHERE is_default');

        Schema::create('party_contacts', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id')->index();
            $table->foreignUuid('party_id')->constrained('parties')->cascadeOnDelete();
            $table->string('name', 200);
            $table->string('title', 100)->nullable();
            $table->string('email', 255)->nullable();
            $table->string('phone', 32)->nullable();
            $table->boolean('is_primary')->default(false);
            $table->unsignedInteger('version')->default(1);
            $table->timestampsTz();
        });
        DB::statement('CREATE UNIQUE INDEX party_contacts_primary_unique ON party_contacts (party_id) WHERE is_primary');

        Schema::create('party_bank_accounts', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id')->index();
            $table->foreignUuid('party_id')->constrained('parties')->cascadeOnDelete();
            $table->string('bank_name', 200);
            $table->string('iban', 34);
            $table->string('swift', 11)->nullable();
            $table->char('currency_code', 3)->nullable();
            $table->boolean('is_default')->default(false);
            $table->unsignedInteger('version')->default(1);
            $table->timestampsTz();

            $table->unique(['party_id', 'iban']);
        });
        DB::statement('CREATE UNIQUE INDEX party_bank_accounts_default_unique ON party_bank_accounts (party_id) WHERE is_default');
    }

    public function down(): void
    {
        Schema::dropIfExists('party_bank_accounts');
        Schema::dropIfExists('party_contacts');
        Schema::dropIfExists('party_addresses');
    }
};
