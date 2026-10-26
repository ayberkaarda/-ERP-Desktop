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
        Schema::table('treasury_payments', fn (Blueprint $t) => $t->string('counterparty_module', 12)->nullable());
        DB::statement("ALTER TABLE treasury_payments ADD CONSTRAINT treasury_counterparty_module CHECK(counterparty_module IN ('sales','purchasing'))");
    }

    public function down(): void
    {
        Schema::table('treasury_payments', fn (Blueprint $t) => $t->dropColumn('counterparty_module'));
    }
};
