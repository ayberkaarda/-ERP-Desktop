<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * stock_movements is the append-only source of truth. stock_valuations (one row per item and
 * warehouse: quantity, value, moving average) and stock_balances (per item, warehouse, location,
 * lot: on hand and reserved) are maintained in the posting transaction and can be rebuilt.
 * The nil uuid stands for "no location" / "no lot" so the balance key stays a plain primary key.
 */
return new class extends Migration
{
    private const string NIL = "'00000000-0000-0000-0000-000000000000'::uuid";

    public function up(): void
    {
        Schema::create('stock_movements', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id');
            $table->uuid('item_id');
            $table->uuid('warehouse_id');
            $table->uuid('location_id')->nullable();
            $table->uuid('lot_id')->nullable();
            $table->uuid('serial_id')->nullable();
            $table->string('movement_type', 16);
            $table->string('direction', 3);
            $table->decimal('quantity', 20, 6);
            $table->decimal('unit_cost', 20, 6);
            $table->decimal('total_cost', 20, 4);
            $table->date('occurred_at');
            $table->string('document_type', 32);
            $table->uuid('document_id');
            $table->uuid('document_line_id')->nullable();
            $table->uuid('journal_entry_id')->nullable();
            $table->uuid('reverses_id')->nullable();
            $table->uuid('cost_layer_id')->nullable();
            $table->uuid('created_by')->nullable();
            $table->timestampTz('created_at')->useCurrent();

            $table->index(['company_id', 'item_id', 'warehouse_id']);
            $table->index(['company_id', 'occurred_at']);
            $table->index('document_id');
            $table->index('lot_id');
            $table->index('serial_id');
            $table->foreign('lot_id')->references('id')->on('stock_lots')->restrictOnDelete();
            $table->foreign('serial_id')->references('id')->on('stock_serials')->restrictOnDelete();
        });

        // Global identity: a strictly increasing ordering key (so also within each company).
        DB::statement('ALTER TABLE stock_movements ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY');
        DB::statement('CREATE UNIQUE INDEX stock_movements_seq_unique ON stock_movements (seq)');
        DB::statement('CREATE INDEX stock_movements_company_seq ON stock_movements (company_id, seq)');
        DB::statement('ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_reverses_fk FOREIGN KEY (reverses_id) REFERENCES stock_movements (id)');
        DB::statement('CREATE UNIQUE INDEX stock_movements_reversed_once ON stock_movements (reverses_id) WHERE reverses_id IS NOT NULL');
        DB::statement("ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check CHECK (movement_type IN ('receipt', 'issue', 'transfer_out', 'transfer_in', 'count_adjustment', 'opening', 'return_in', 'return_out', 'production_in', 'production_out', 'scrap'))");
        DB::statement("ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_direction_check CHECK (direction IN ('in', 'out'))");
        DB::statement('ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_amounts_check CHECK (quantity > 0 AND unit_cost >= 0 AND total_cost >= 0)');
        // Regular movements follow their type; a reversal mirrors the direction of what it reverses.
        DB::statement("ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_direction_check CHECK (
            reverses_id IS NOT NULL
            OR movement_type = 'count_adjustment'
            OR (direction = 'in' AND movement_type IN ('receipt', 'transfer_in', 'opening', 'return_in', 'production_in'))
            OR (direction = 'out' AND movement_type IN ('issue', 'transfer_out', 'return_out', 'production_out', 'scrap')))");
        DB::statement('ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_serial_qty_check CHECK (serial_id IS NULL OR quantity = 1)');

        Schema::create('stock_valuations', function (Blueprint $table): void {
            $table->uuid('company_id');
            $table->uuid('item_id');
            $table->uuid('warehouse_id');
            $table->decimal('quantity', 20, 6)->default(0);
            $table->decimal('value', 20, 4)->default(0);
            $table->decimal('avg_cost', 20, 6)->default(0);
            $table->timestampTz('updated_at')->useCurrent();

            $table->primary(['company_id', 'item_id', 'warehouse_id']);
        });

        Schema::create('stock_balances', function (Blueprint $table): void {
            $table->uuid('company_id');
            $table->uuid('item_id');
            $table->uuid('warehouse_id');
            $table->uuid('location_id')->default(DB::raw(self::NIL));
            $table->uuid('lot_id')->default(DB::raw(self::NIL));
            $table->decimal('on_hand', 20, 6)->default(0);
            $table->decimal('reserved', 20, 6)->default(0);
            $table->decimal('avg_cost', 20, 6)->default(0);
            $table->decimal('value', 20, 4)->default(0);
            $table->timestampTz('updated_at')->useCurrent();

            $table->primary(['company_id', 'item_id', 'warehouse_id', 'location_id', 'lot_id']);
            $table->index(['company_id', 'warehouse_id']);
        });
        DB::statement('ALTER TABLE stock_balances ADD COLUMN available numeric(20,6) GENERATED ALWAYS AS (on_hand - reserved) STORED');
        DB::statement('ALTER TABLE stock_balances ADD CONSTRAINT stock_balances_reserved_check CHECK (reserved >= 0)');

        Schema::create('stock_cost_layers', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id');
            $table->uuid('item_id');
            $table->uuid('warehouse_id');
            $table->uuid('movement_id');
            $table->decimal('original_qty', 20, 6);
            $table->decimal('remaining_qty', 20, 6);
            $table->decimal('remaining_value', 20, 4);
            $table->decimal('unit_cost', 20, 6);
            $table->date('received_at');
            $table->timestampTz('created_at')->useCurrent();

            $table->index(['company_id', 'item_id', 'warehouse_id', 'received_at']);
            $table->foreign('movement_id')->references('id')->on('stock_movements')->restrictOnDelete();
        });
        DB::statement('ALTER TABLE stock_cost_layers ADD CONSTRAINT stock_cost_layers_qty_check CHECK (remaining_qty >= 0 AND remaining_qty <= original_qty AND remaining_value >= 0)');
        // An outbound FIFO movement names the layer it consumed; the layer may be written after it.
        DB::statement('ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_layer_fk FOREIGN KEY (cost_layer_id) REFERENCES stock_cost_layers (id) DEFERRABLE INITIALLY DEFERRED');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE IF EXISTS stock_movements DROP CONSTRAINT IF EXISTS stock_movements_layer_fk');
        Schema::dropIfExists('stock_cost_layers');
        Schema::dropIfExists('stock_balances');
        Schema::dropIfExists('stock_valuations');
        Schema::dropIfExists('stock_movements');
    }
};
