<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Makes parties pullable by offline clients: the party is tracked (sync position, tombstones on
 * soft delete) and its addresses, contacts and bank accounts move the party's position when they
 * change, without touching its version. Hard-deleted children leave no tombstone of their own
 * (child tables are not tracked); the embedding party is re-sent without them.
 */
return new class extends Migration
{
    private const array CHILDREN = ['party_addresses', 'party_contacts', 'party_bank_accounts'];

    public function up(): void
    {
        Schema::table('parties', function (Blueprint $table): void {
            $table->syncable();
        });

        foreach (self::CHILDREN as $child) {
            Schema::table($child, function (Blueprint $table): void {
                $table->syncable(parent: 'parties', parentKey: ['party_id']);
            });
        }
    }

    public function down(): void
    {
        foreach (self::CHILDREN as $child) {
            Schema::table($child, function (Blueprint $table): void {
                $table->dropSyncable(parent: 'parties');
            });
        }

        Schema::table('parties', function (Blueprint $table): void {
            $table->dropSyncable();
        });
    }
};
