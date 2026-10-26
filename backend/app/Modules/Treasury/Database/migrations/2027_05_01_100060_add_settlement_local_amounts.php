<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        foreach (['sales_receivable_applications', 'purchase_payable_applications'] as $table) {
            Schema::table($table, fn (Blueprint $t) => $t->decimal('local_amount', 20, 4)->nullable());
        }
    }

    public function down(): void
    {
        foreach (['sales_receivable_applications', 'purchase_payable_applications'] as $table) {
            Schema::table($table, fn (Blueprint $t) => $t->dropColumn('local_amount'));
        }
    }
};
