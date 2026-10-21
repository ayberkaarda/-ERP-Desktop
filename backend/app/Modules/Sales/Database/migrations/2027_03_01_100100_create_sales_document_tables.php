<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Sales documents (quote, order, delivery, invoice, return) share one header and one line layout.
 * Party, item, unit, tax code, warehouse, journal and stock ids of other modules are plain uuids;
 * links inside the module are foreign keys. Totals are stored in the document currency and in the
 * company currency (*_local).
 */
return new class extends Migration
{
    private const array HEADERS = ['sales_quotes', 'sales_orders', 'sales_deliveries', 'sales_invoices', 'sales_returns'];

    public function up(): void
    {
        Schema::create('sales_quotes', function (Blueprint $t): void {
            $this->header($t);
            $t->date('valid_until')->nullable();
            $t->unsignedInteger('revision')->default(1);
            $t->uuid('previous_revision_id')->nullable();
            $t->uuid('converted_order_id')->nullable();
            $t->timestampTz('sent_at')->nullable();
            $t->timestampTz('accepted_at')->nullable();
            $t->timestampTz('rejected_at')->nullable();
            $t->string('rejection_reason', 1000)->nullable();
        });
        Schema::table('sales_quotes', function (Blueprint $t): void {
            $t->foreign('previous_revision_id')->references('id')->on('sales_quotes')->nullOnDelete();
        });
        Schema::create('sales_quote_lines', function (Blueprint $t): void {
            $this->line($t, 'sales_quotes');
        });

        Schema::create('sales_orders', function (Blueprint $t): void {
            $this->header($t);
            $t->date('requested_delivery_date')->nullable();
            $t->foreignUuid('quote_id')->nullable()->constrained('sales_quotes')->nullOnDelete();
            $t->unsignedInteger('revision')->default(1);
            $t->string('credit_override_reason', 1000)->nullable();
            $t->uuid('credit_override_by')->nullable();
            $t->uuid('approval_request_id')->nullable();
            $t->string('approval_comment', 1000)->nullable();
            $t->timestampTz('confirmed_at')->nullable();
            $t->uuid('confirmed_by')->nullable();
            $t->timestampTz('cancelled_at')->nullable();
            $t->timestampTz('closed_at')->nullable();
        });
        Schema::create('sales_order_lines', function (Blueprint $t): void {
            $this->line($t, 'sales_orders');
            $t->decimal('delivered_quantity', 20, 6)->default(0);
            $t->decimal('invoiced_quantity', 20, 6)->default(0);
            $t->uuid('reservation_id')->nullable();
        });

        Schema::create('sales_deliveries', function (Blueprint $t): void {
            $this->header($t);
            $t->foreignUuid('order_id')->nullable()->constrained('sales_orders')->restrictOnDelete();
            $t->uuid('invoice_id')->nullable();
            $t->uuid('stock_document_id')->nullable();
            $t->uuid('journal_entry_id')->nullable();
            $t->decimal('cost_total', 20, 4)->default(0);
            $t->timestampTz('posted_at')->nullable();
            $t->uuid('posted_by')->nullable();
            $t->timestampTz('cancelled_at')->nullable();
            $t->uuid('cancelled_by')->nullable();
            $t->string('cancel_reason', 1000)->nullable();
            $t->uuid('reversal_stock_document_id')->nullable();
        });
        Schema::create('sales_delivery_lines', function (Blueprint $t): void {
            $this->line($t, 'sales_deliveries');
            $t->foreignUuid('order_line_id')->nullable()->constrained('sales_order_lines')->restrictOnDelete();
            $t->string('lot_no', 64)->nullable();
            $t->jsonb('serial_numbers')->default('[]');
            $t->decimal('unit_cost', 20, 6)->nullable();
            $t->decimal('cost_total', 20, 4)->nullable();
        });

        Schema::create('sales_invoices', function (Blueprint $t): void {
            $this->header($t);
            $t->string('invoice_type', 8)->default('sale');
            $t->foreignUuid('order_id')->nullable()->constrained('sales_orders')->restrictOnDelete();
            $t->foreignUuid('delivery_id')->nullable()->constrained('sales_deliveries')->restrictOnDelete();
            $t->uuid('return_id')->nullable();
            $t->uuid('original_invoice_id')->nullable();
            $t->boolean('deliver_on_invoice')->default(false);
            $t->uuid('journal_entry_id')->nullable();
            $t->uuid('reversal_journal_entry_id')->nullable();
            $t->decimal('paid_amount', 20, 4)->default(0);
            $t->decimal('balance_due', 20, 4)->default(0);
            $t->timestampTz('issued_at')->nullable();
            $t->uuid('issued_by')->nullable();
            $t->timestampTz('reversed_at')->nullable();
            $t->uuid('reversed_by')->nullable();
            $t->date('reversal_date')->nullable();
            $t->string('reversal_reason', 1000)->nullable();
            $t->string('credit_override_reason', 1000)->nullable();
            $t->uuid('credit_override_by')->nullable();
            $t->string('e_document_status', 32)->nullable();
            $t->uuid('e_document_uuid')->nullable();
        });
        Schema::table('sales_invoices', function (Blueprint $t): void {
            $t->foreign('original_invoice_id')->references('id')->on('sales_invoices')->restrictOnDelete();
        });
        Schema::table('sales_deliveries', function (Blueprint $t): void {
            $t->foreign('invoice_id')->references('id')->on('sales_invoices')->nullOnDelete();
        });
        Schema::create('sales_invoice_lines', function (Blueprint $t): void {
            $this->line($t, 'sales_invoices');
            $t->foreignUuid('order_line_id')->nullable()->constrained('sales_order_lines')->restrictOnDelete();
            $t->foreignUuid('delivery_line_id')->nullable()->constrained('sales_delivery_lines')->restrictOnDelete();
            $t->uuid('original_line_id')->nullable();
            $t->index('delivery_line_id');
            $t->index('order_line_id');
        });
        Schema::table('sales_invoice_lines', function (Blueprint $t): void {
            $t->foreign('original_line_id')->references('id')->on('sales_invoice_lines')->restrictOnDelete();
        });

        Schema::create('sales_returns', function (Blueprint $t): void {
            $this->header($t);
            $t->foreignUuid('invoice_id')->constrained('sales_invoices')->restrictOnDelete();
            $t->string('reason', 1000)->nullable();
            $t->uuid('stock_document_id')->nullable();
            $t->uuid('journal_entry_id')->nullable();
            $t->foreignUuid('credit_invoice_id')->nullable()->constrained('sales_invoices')->nullOnDelete();
            $t->timestampTz('approved_at')->nullable();
            $t->uuid('approved_by')->nullable();
            $t->timestampTz('received_at')->nullable();
            $t->uuid('received_by')->nullable();
            $t->timestampTz('credited_at')->nullable();
            $t->uuid('credited_by')->nullable();
            $t->timestampTz('cancelled_at')->nullable();
        });
        Schema::create('sales_return_lines', function (Blueprint $t): void {
            $this->line($t, 'sales_returns');
            $t->foreignUuid('invoice_line_id')->constrained('sales_invoice_lines')->restrictOnDelete();
            $t->foreignUuid('delivery_line_id')->nullable()->constrained('sales_delivery_lines')->restrictOnDelete();
            $t->string('lot_no', 64)->nullable();
            $t->jsonb('serial_numbers')->default('[]');
            $t->decimal('unit_cost', 20, 6)->nullable();
            $t->decimal('cost_total', 20, 4)->nullable();
            $t->index('invoice_line_id');
        });
        Schema::table('sales_invoices', function (Blueprint $t): void {
            $t->foreign('return_id')->references('id')->on('sales_returns')->nullOnDelete();
        });

        Schema::create('sales_receivable_applications', function (Blueprint $t): void {
            $t->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $t->uuid('company_id');
            $t->foreignUuid('invoice_id')->constrained('sales_invoices')->restrictOnDelete();
            $t->string('reference', 100);
            $t->decimal('amount', 20, 4);
            $t->timestampTz('applied_at');
            $t->timestampTz('unapplied_at')->nullable();
            $t->uuid('created_by')->nullable();
            $t->timestampsTz();
            $t->unique(['company_id', 'invoice_id', 'reference']);
        });

        foreach (self::HEADERS as $table) {
            $unique = $table === 'sales_invoices' ? '(company_id, invoice_type, number)' : '(company_id, number)';
            DB::statement("CREATE UNIQUE INDEX {$table}_number_unique ON {$table} {$unique} WHERE number IS NOT NULL");
            DB::statement("CREATE INDEX {$table}_party_name_trgm ON {$table} USING gin (party_name gin_trgm_ops)");
            DB::statement("ALTER TABLE {$table} ADD CONSTRAINT {$table}_fx_rate_positive CHECK (fx_rate > 0)");
            DB::statement("ALTER TABLE {$table} ADD CONSTRAINT {$table}_totals_check CHECK (total = subtotal - discount_total + tax_total)");

            $lines = substr($table, 0, -1).'_lines';
            $lines = match ($table) {
                'sales_deliveries' => 'sales_delivery_lines',
                default => $lines,
            };
            DB::statement("ALTER TABLE {$lines} ADD CONSTRAINT {$lines}_quantity_positive CHECK (quantity > 0 AND base_quantity > 0)");
            DB::statement("ALTER TABLE {$lines} ADD CONSTRAINT {$lines}_amounts_check CHECK (discount_percent BETWEEN 0 AND 100 AND unit_price >= 0 AND discount_amount >= 0 AND line_total = net_amount + tax_amount)");
        }

        DB::statement("ALTER TABLE sales_quotes ADD CONSTRAINT sales_quotes_status_check CHECK (status IN ('draft','sent','accepted','rejected','expired','converted','cancelled'))");
        DB::statement("ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_status_check CHECK (status IN ('draft','pending_approval','confirmed','partially_delivered','delivered','partially_invoiced','invoiced','closed','cancelled'))");
        DB::statement("ALTER TABLE sales_deliveries ADD CONSTRAINT sales_deliveries_status_check CHECK (status IN ('draft','posted','cancelled'))");
        DB::statement("ALTER TABLE sales_invoices ADD CONSTRAINT sales_invoices_status_check CHECK (status IN ('draft','pending_approval','issued','partially_paid','paid','cancelled','reversed'))");
        DB::statement("ALTER TABLE sales_returns ADD CONSTRAINT sales_returns_status_check CHECK (status IN ('draft','approved','received','credited','cancelled'))");
        DB::statement("ALTER TABLE sales_invoices ADD CONSTRAINT sales_invoices_type_check CHECK (invoice_type IN ('sale','return'))");
        DB::statement('ALTER TABLE sales_order_lines ADD CONSTRAINT sales_order_lines_progress_check CHECK (delivered_quantity >= 0 AND invoiced_quantity >= 0)');
        DB::statement('ALTER TABLE sales_receivable_applications ADD CONSTRAINT sales_receivable_applications_amount_positive CHECK (amount > 0)');
        DB::statement("ALTER TABLE sales_deliveries ADD CONSTRAINT sales_deliveries_posted_check CHECK (status = 'draft' OR (status = 'cancelled' AND posted_at IS NULL) OR (number IS NOT NULL AND stock_document_id IS NOT NULL))");
        DB::statement(<<<'SQL'
            ALTER TABLE sales_invoices ADD CONSTRAINT sales_invoices_balance_check CHECK (
                paid_amount >= 0 AND balance_due >= 0 AND paid_amount <= total
                AND (status IN ('draft', 'pending_approval', 'cancelled') OR (number IS NOT NULL AND journal_entry_id IS NOT NULL))
                AND (status NOT IN ('issued', 'partially_paid', 'paid') OR balance_due = total - paid_amount)
                AND (status <> 'reversed' OR (paid_amount = 0 AND balance_due = 0))
            )
            SQL);
    }

    public function down(): void
    {
        foreach (['sales_receivable_applications', 'sales_return_lines', 'sales_invoice_lines'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::table('sales_invoices', function (Blueprint $t): void {
            $t->dropForeign(['return_id']);
        });
        Schema::table('sales_deliveries', function (Blueprint $t): void {
            $t->dropForeign(['invoice_id']);
        });

        foreach (['sales_returns', 'sales_invoices', 'sales_delivery_lines', 'sales_deliveries', 'sales_order_lines', 'sales_orders', 'sales_quote_lines', 'sales_quotes'] as $table) {
            Schema::dropIfExists($table);
        }
    }

    private function header(Blueprint $t): void
    {
        $t->uuid('id')->primary()->default(DB::raw('uuidv7()'));
        $t->uuid('company_id');
        $t->string('number', 32)->nullable();
        $t->string('status', 24);
        $t->date('document_date');
        $t->uuid('party_id');
        $t->string('party_name', 255);
        $t->string('party_tax_office', 100)->nullable();
        $t->string('party_tax_number', 20)->nullable();
        $t->jsonb('billing_address')->nullable();
        $t->char('currency_code', 3);
        $t->decimal('fx_rate', 20, 6)->default(1);
        $t->uuid('payment_term_id')->nullable();
        $t->date('due_date')->nullable();
        $t->uuid('price_list_id')->nullable();
        $t->uuid('warehouse_id')->nullable();
        $t->uuid('cost_center_id')->nullable();
        $t->uuid('project_id')->nullable();
        $t->text('notes')->nullable();
        $t->text('internal_notes')->nullable();
        $t->string('source_type', 32)->nullable();
        $t->uuid('source_id')->nullable();

        foreach (['subtotal', 'discount_total', 'tax_total', 'total'] as $column) {
            $t->decimal($column, 20, 4)->default(0);
            $t->decimal($column.'_local', 20, 4)->default(0);
        }

        $t->unsignedInteger('version')->default(1);
        $t->uuid('created_by')->nullable();
        $t->timestampsTz();
        $t->index(['company_id', 'document_date']);
        $t->index(['company_id', 'party_id']);
        $t->index(['company_id', 'status']);
        $t->index(['source_type', 'source_id']);
    }

    private function line(Blueprint $t, string $header): void
    {
        $t->uuid('id')->primary()->default(DB::raw('uuidv7()'));
        $t->uuid('company_id');
        $t->foreignUuid('document_id')->constrained($header)->cascadeOnDelete();
        $t->unsignedInteger('line_no');
        $t->uuid('item_id');
        $t->uuid('variant_id')->nullable();
        $t->string('item_type', 16);
        $t->string('description', 500)->nullable();
        $t->decimal('quantity', 20, 6);
        $t->uuid('unit_id');
        $t->decimal('base_quantity', 20, 6);
        $t->decimal('unit_price', 20, 6)->default(0);
        $t->boolean('tax_inclusive')->default(false);
        $t->decimal('discount_percent', 7, 4)->default(0);
        $t->decimal('discount_amount', 20, 4)->default(0);
        $t->decimal('gross_amount', 20, 4)->default(0);
        $t->decimal('line_discount', 20, 4)->default(0);
        $t->decimal('net_amount', 20, 4)->default(0);
        $t->uuid('tax_code_id')->nullable();
        $t->decimal('tax_rate', 7, 4)->default(0);
        $t->decimal('tax_amount', 20, 4)->default(0);
        $t->decimal('line_total', 20, 4)->default(0);
        $t->uuid('warehouse_id')->nullable();
        $t->uuid('source_line_id')->nullable();
        $t->string('price_source', 32)->nullable();
        $t->unique(['document_id', 'line_no']);
        $t->index(['company_id', 'item_id']);
    }
};
