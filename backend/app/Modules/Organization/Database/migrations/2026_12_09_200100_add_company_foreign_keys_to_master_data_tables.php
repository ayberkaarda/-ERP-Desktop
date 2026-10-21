<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Foreign keys from the Reference, Parties and Catalog tables to companies. Dated 2026_12_09 so it
 * runs after those modules' 2026_12_01_1xxxxx/2xxxxx/3xxxxx migrations.
 *
 * Choices:
 * - company_id: RESTRICT everywhere. Master data is referenced by documents of later phases;
 *   purging a tenant must be a deliberate, ordered process, never a side effect. Companies are
 *   normally soft deleted, so the constraint does not fire in day to day use.
 * - Nullable company_id (exchange_rates: null for global TCMB fixings; tax_codes: null for the
 *   global seeded codes) is constrained the same way; null rows are not checked.
 * - Tables of a module that is not installed are skipped, so a bare install still migrates.
 */
return new class extends Migration
{
    /** @var list<string> */
    private const array TABLES = [
        // Reference
        'company_currencies', 'exchange_rates', 'tax_codes', 'payment_terms', 'warehouses', 'locations',
        'cost_centers', 'projects',
        // Parties
        'parties', 'party_addresses', 'party_contacts', 'party_bank_accounts',
        // Catalog
        'units', 'unit_conversions', 'item_categories', 'items', 'item_variants', 'item_units',
        'item_barcodes', 'price_lists', 'price_list_lines', 'discount_rules',
    ];

    public function up(): void
    {
        foreach (self::TABLES as $table) {
            if (Schema::hasTable($table)) {
                Schema::table($table, function (Blueprint $t): void {
                    $t->foreign('company_id')->references('id')->on('companies')->restrictOnDelete();
                });
            }
        }
    }

    public function down(): void
    {
        foreach (array_reverse(self::TABLES) as $table) {
            if (Schema::hasTable($table)) {
                Schema::table($table, function (Blueprint $t): void {
                    $t->dropForeign(['company_id']);
                });
            }
        }
    }
};
