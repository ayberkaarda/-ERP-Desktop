<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        foreach (['currencies', 'company_currencies', 'exchange_rates', 'tax_codes', 'payment_terms', 'warehouses', 'cost_centers', 'projects'] as $name) {
            Schema::table($name, function (Blueprint $table): void {
                $table->syncable();
            });
        }

        // The macro detects company_id but has no nullable-company index option.
        foreach (['exchange_rates', 'tax_codes'] as $name) {
            Schema::table($name, function (Blueprint $table) use ($name): void {
                $table->index(['sync_txid', 'id'], $name.'_sync_global_index');
            });
        }

        Schema::table('locations', function (Blueprint $table): void {
            $table->syncable(parent: 'warehouses', parentKey: ['warehouse_id'], tracked: true);
        });
    }

    public function down(): void
    {
        Schema::table('locations', function (Blueprint $table): void {
            $table->dropSyncable(parent: 'warehouses', tracked: true);
        });

        foreach (['exchange_rates', 'tax_codes'] as $name) {
            Schema::table($name, function (Blueprint $table) use ($name): void {
                $table->dropIndex($name.'_sync_global_index');
            });
        }

        foreach (['projects', 'cost_centers', 'warehouses', 'payment_terms', 'tax_codes', 'exchange_rates', 'company_currencies', 'currencies'] as $name) {
            Schema::table($name, function (Blueprint $table): void {
                $table->dropSyncable();
            });
        }
    }
};
