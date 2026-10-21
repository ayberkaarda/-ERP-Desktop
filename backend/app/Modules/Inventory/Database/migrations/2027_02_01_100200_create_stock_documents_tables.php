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
        Schema::create('stock_documents', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id');
            $table->string('doc_type', 12);
            $table->string('number', 40)->nullable();
            $table->string('status', 12)->default('draft');
            $table->date('document_date');
            $table->uuid('warehouse_id');
            $table->uuid('target_warehouse_id')->nullable();
            $table->string('reason', 500)->nullable();
            $table->text('notes')->nullable();
            $table->string('offset_event', 100)->nullable();
            $table->boolean('allow_expired')->default(false);
            $table->string('source_type', 64)->nullable();
            $table->uuid('source_id')->nullable();
            $table->string('purpose', 64)->nullable();
            $table->uuid('journal_entry_id')->nullable();
            $table->timestampTz('frozen_at')->nullable();
            $table->timestampTz('posted_at')->nullable();
            $table->uuid('posted_by')->nullable();
            $table->date('reversal_date')->nullable();
            $table->string('reversal_reason', 1000)->nullable();
            $table->uuid('reversal_journal_entry_id')->nullable();
            $table->timestampTz('reversed_at')->nullable();
            $table->uuid('reversed_by')->nullable();
            $table->uuid('created_by')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestampsTz();

            $table->index(['company_id', 'doc_type', 'status', 'document_date']);
            $table->index(['company_id', 'warehouse_id']);
        });

        DB::statement("ALTER TABLE stock_documents ADD CONSTRAINT stock_documents_type_check CHECK (doc_type IN ('receipt', 'issue', 'transfer', 'count', 'adjustment', 'opening'))");
        DB::statement("ALTER TABLE stock_documents ADD CONSTRAINT stock_documents_status_check CHECK (status IN ('draft', 'posted', 'cancelled'))");
        DB::statement("ALTER TABLE stock_documents ADD CONSTRAINT stock_documents_target_check CHECK ((doc_type = 'transfer') = (target_warehouse_id IS NOT NULL))");
        DB::statement("ALTER TABLE stock_documents ADD CONSTRAINT stock_documents_number_check CHECK ((status = 'draft') = (number IS NULL))");
        DB::statement('CREATE UNIQUE INDEX stock_documents_number_unique ON stock_documents (company_id, doc_type, number) WHERE number IS NOT NULL');
        // One stock document per source document and purpose (contract postings are idempotent).
        DB::statement('CREATE UNIQUE INDEX stock_documents_source_unique ON stock_documents (company_id, source_type, source_id, purpose) WHERE source_type IS NOT NULL');
        DB::statement('CREATE INDEX stock_documents_number_trgm ON stock_documents USING gin (number gin_trgm_ops)');

        Schema::create('stock_document_lines', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id');
            $table->uuid('document_id');
            $table->unsignedInteger('line_no');
            $table->uuid('item_id');
            $table->uuid('unit_id');
            $table->decimal('quantity', 20, 6)->default(0);
            $table->decimal('base_quantity', 20, 6)->default(0);
            $table->decimal('unit_cost', 20, 6)->nullable();
            $table->string('lot_no', 64)->nullable();
            $table->date('expiry_date')->nullable();
            $table->jsonb('serial_numbers')->default(DB::raw("'[]'::jsonb"));
            $table->uuid('location_id')->nullable();
            $table->uuid('target_location_id')->nullable();
            $table->string('direction', 3)->nullable();
            $table->decimal('system_quantity', 20, 6)->nullable();
            $table->decimal('counted_quantity', 20, 6)->nullable();
            $table->string('notes', 500)->nullable();
            $table->uuid('reservation_id')->nullable();

            $table->unique(['document_id', 'line_no']);
            $table->index(['company_id', 'item_id']);
            $table->foreign('document_id')->references('id')->on('stock_documents')->cascadeOnDelete();
        });

        DB::statement('ALTER TABLE stock_document_lines ADD CONSTRAINT stock_document_lines_qty_check CHECK (quantity >= 0 AND base_quantity >= 0 AND (unit_cost IS NULL OR unit_cost >= 0) AND (counted_quantity IS NULL OR counted_quantity >= 0) AND (system_quantity IS NULL OR system_quantity >= 0))');
        DB::statement("ALTER TABLE stock_document_lines ADD CONSTRAINT stock_document_lines_direction_check CHECK (direction IS NULL OR direction IN ('in', 'out'))");
        DB::statement("ALTER TABLE stock_document_lines ADD CONSTRAINT stock_document_lines_serials_check CHECK (jsonb_typeof(serial_numbers) = 'array')");
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_document_lines');
        Schema::dropIfExists('stock_documents');
    }
};
