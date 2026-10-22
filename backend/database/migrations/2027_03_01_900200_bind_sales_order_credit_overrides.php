<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * What a recorded order credit override authorised: the customer, the order revision, the order
 * total (company currency) and the resulting exposure with its risk currency. An invoice of the
 * order inherits the override only while all of them still hold. Overrides recorded before this
 * migration carry no binding and are no longer inherited (they stay on the order as history).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('sales_orders')) {
            return;
        }

        Schema::table('sales_orders', function (Blueprint $t): void {
            $t->uuid('credit_override_party_id')->nullable();
            $t->unsignedInteger('credit_override_revision')->nullable();
            $t->decimal('credit_override_amount', 20, 4)->nullable();
            $t->decimal('credit_override_exposure', 20, 4)->nullable();
            $t->char('credit_override_currency', 3)->nullable();
        });
        DB::statement('ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_credit_override_binding_check CHECK (
            credit_override_party_id IS NULL OR (credit_override_reason IS NOT NULL AND credit_override_revision IS NOT NULL
                AND credit_override_amount IS NOT NULL AND credit_override_exposure IS NOT NULL AND credit_override_currency IS NOT NULL))');
    }

    public function down(): void
    {
        if (! Schema::hasTable('sales_orders')) {
            return;
        }

        DB::statement('ALTER TABLE sales_orders DROP CONSTRAINT IF EXISTS sales_orders_credit_override_binding_check');
        Schema::table('sales_orders', function (Blueprint $t): void {
            $t->dropColumn(['credit_override_party_id', 'credit_override_revision', 'credit_override_amount', 'credit_override_exposure', 'credit_override_currency']);
        });
    }
};
