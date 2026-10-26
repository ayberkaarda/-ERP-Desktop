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
        foreach (['sales_receivable_applications', 'purchase_payable_applications'] as $table) {
            Schema::table($table, function (Blueprint $t): void {
                $t->date('effective_date')->nullable();
                $t->date('unapplied_effective_date')->nullable();
            });
            DB::statement("UPDATE {$table} SET effective_date=applied_at::date,unapplied_effective_date=unapplied_at::date");
        }
    }

    public function down(): void
    {
        foreach (['sales_receivable_applications', 'purchase_payable_applications'] as $table) {
            Schema::table($table, fn (Blueprint $t) => $t->dropColumn(['effective_date', 'unapplied_effective_date']));
        }
    }
};
