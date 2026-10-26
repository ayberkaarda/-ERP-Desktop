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
        Schema::create('stock_reservations', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id');
            $table->uuid('item_id');
            $table->uuid('warehouse_id');
            $table->uuid('lot_id')->nullable();
            $table->decimal('quantity', 20, 6);
            $table->string('status', 10)->default('active');
            $table->string('source_type', 64)->nullable();
            $table->uuid('source_id')->nullable();
            $table->timestampTz('expires_at')->nullable();
            $table->timestampTz('closed_at')->nullable();
            $table->string('notes', 500)->nullable();
            $table->uuid('created_by')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestampsTz();

            $table->index(['company_id', 'item_id', 'warehouse_id', 'status']);
            $table->index(['company_id', 'source_type', 'source_id']);
            $table->foreign('lot_id')->references('id')->on('stock_lots')->restrictOnDelete();
        });

        DB::statement('ALTER TABLE stock_reservations ADD CONSTRAINT stock_reservations_qty_check CHECK (quantity > 0)');
        DB::statement("ALTER TABLE stock_reservations ADD CONSTRAINT stock_reservations_status_check CHECK (status IN ('active', 'released', 'consumed', 'expired'))");
        DB::statement("CREATE INDEX stock_reservations_expiry ON stock_reservations (expires_at) WHERE status = 'active' AND expires_at IS NOT NULL");
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_reservations');
    }
};
