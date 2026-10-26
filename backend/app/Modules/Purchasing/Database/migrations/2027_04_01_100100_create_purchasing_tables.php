<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Purchasing: requests, RFQs (suppliers and their quotes), orders, goods receipts, supplier invoices
 * (and debit notes) and returns. Orders, receipts, invoices and returns share one header and one
 * line layout with the supplier as party; requests and RFQs have their own lighter layout. Ids of
 * other modules are plain uuids; links inside the module are foreign keys. Totals are stored in the
 * document currency and in the company currency (*_local).
 */
return new class extends Migration
{
    private const array HEADERS = [
        'purchase_orders' => 'purchase_order_lines',
        'purchase_receipts' => 'purchase_receipt_lines',
        'purchase_invoices' => 'purchase_invoice_lines',
        'purchase_returns' => 'purchase_return_lines',
    ];

    public function up(): void
    {
        Schema::create('purchase_requests', function (Blueprint $t): void {
            $t->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $t->uuid('company_id');
            $t->string('number', 32)->nullable();
            $t->string('status', 24);
            $t->date('document_date');
            $t->date('needed_by')->nullable();
            $t->uuid('requested_by')->nullable();
            $t->uuid('warehouse_id')->nullable();
            $t->uuid('cost_center_id')->nullable();
            $t->uuid('project_id')->nullable();
            $t->char('currency_code', 3);
            $t->text('notes')->nullable();
            $t->text('internal_notes')->nullable();
            $t->decimal('estimated_total', 20, 4)->default(0);
            $t->uuid('approval_request_id')->nullable();
            $t->string('approval_comment', 1000)->nullable();
            $t->timestampTz('submitted_at')->nullable();
            $t->timestampTz('approved_at')->nullable();
            $t->timestampTz('rejected_at')->nullable();
            $t->timestampTz('cancelled_at')->nullable();
            $t->unsignedInteger('version')->default(1);
            $t->uuid('created_by')->nullable();
            $t->timestampsTz();
            $t->index(['company_id', 'document_date']);
            $t->index(['company_id', 'status']);
        });
        Schema::create('purchase_request_lines', function (Blueprint $t): void {
            $this->baseLine($t, 'purchase_requests');
            $t->decimal('estimated_price', 20, 6)->default(0);
            $t->decimal('estimated_total', 20, 4)->default(0);
            $t->uuid('suggested_supplier_id')->nullable();
            $t->date('needed_by')->nullable();
            $t->uuid('warehouse_id')->nullable();
        });

        Schema::create('purchase_rfqs', function (Blueprint $t): void {
            $t->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $t->uuid('company_id');
            $t->string('number', 32)->nullable();
            $t->string('status', 24);
            $t->date('document_date');
            $t->date('response_due')->nullable();
            $t->foreignUuid('request_id')->nullable()->constrained('purchase_requests')->restrictOnDelete();
            $t->char('currency_code', 3);
            $t->uuid('warehouse_id')->nullable();
            $t->text('notes')->nullable();
            $t->text('internal_notes')->nullable();
            $t->timestampTz('sent_at')->nullable();
            $t->timestampTz('awarded_at')->nullable();
            $t->uuid('awarded_by')->nullable();
            $t->timestampTz('cancelled_at')->nullable();
            $t->unsignedInteger('version')->default(1);
            $t->uuid('created_by')->nullable();
            $t->timestampsTz();
            $t->index(['company_id', 'document_date']);
            $t->index(['company_id', 'status']);
        });
        Schema::create('purchase_rfq_lines', function (Blueprint $t): void {
            $this->baseLine($t, 'purchase_rfqs');
            $t->foreignUuid('request_line_id')->nullable()->constrained('purchase_request_lines')->restrictOnDelete();
            $t->date('needed_by')->nullable();
            $t->uuid('awarded_party_id')->nullable();
            $t->uuid('awarded_quote_id')->nullable();
        });
        Schema::create('purchase_rfq_suppliers', function (Blueprint $t): void {
            $t->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $t->uuid('company_id');
            $t->foreignUuid('rfq_id')->constrained('purchase_rfqs')->cascadeOnDelete();
            $t->uuid('party_id');
            $t->string('party_name', 255);
            $t->string('status', 16)->default('invited');
            $t->timestampTz('responded_at')->nullable();
            $t->timestampsTz();
            $t->unique(['rfq_id', 'party_id']);
        });
        Schema::create('purchase_rfq_quotes', function (Blueprint $t): void {
            $t->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $t->uuid('company_id');
            $t->foreignUuid('rfq_id')->constrained('purchase_rfqs')->cascadeOnDelete();
            $t->foreignUuid('rfq_line_id')->constrained('purchase_rfq_lines')->cascadeOnDelete();
            $t->uuid('party_id');
            $t->decimal('unit_price', 20, 6);
            $t->decimal('discount_percent', 7, 4)->default(0);
            $t->unsignedInteger('lead_time_days')->nullable();
            $t->date('valid_until')->nullable();
            $t->string('notes', 1000)->nullable();
            $t->timestampsTz();
            $t->unique(['rfq_line_id', 'party_id']);
        });
        Schema::table('purchase_rfq_lines', function (Blueprint $t): void {
            $t->foreign('awarded_quote_id')->references('id')->on('purchase_rfq_quotes')->nullOnDelete();
        });

        Schema::create('purchase_orders', function (Blueprint $t): void {
            $this->header($t);
            $t->date('expected_date')->nullable();
            $t->string('supplier_reference', 100)->nullable();
            $t->foreignUuid('request_id')->nullable()->constrained('purchase_requests')->restrictOnDelete();
            $t->foreignUuid('rfq_id')->nullable()->constrained('purchase_rfqs')->restrictOnDelete();
            $t->unsignedInteger('revision')->default(1);
            $t->uuid('approval_request_id')->nullable();
            $t->string('approval_comment', 1000)->nullable();
            $t->timestampTz('approved_at')->nullable();
            $t->uuid('approved_by')->nullable();
            $t->timestampTz('sent_at')->nullable();
            $t->timestampTz('cancelled_at')->nullable();
            $t->timestampTz('closed_at')->nullable();
        });
        Schema::create('purchase_order_lines', function (Blueprint $t): void {
            $this->line($t, 'purchase_orders');
            $t->decimal('received_quantity', 20, 6)->default(0);
            $t->decimal('invoiced_quantity', 20, 6)->default(0);
            $t->foreignUuid('request_line_id')->nullable()->constrained('purchase_request_lines')->restrictOnDelete();
            $t->foreignUuid('rfq_line_id')->nullable()->constrained('purchase_rfq_lines')->restrictOnDelete();
            $t->date('expected_date')->nullable();
            $t->index('request_line_id');
        });

        Schema::create('purchase_receipts', function (Blueprint $t): void {
            $this->header($t);
            $t->foreignUuid('order_id')->nullable()->constrained('purchase_orders')->restrictOnDelete();
            $t->uuid('invoice_id')->nullable();
            $t->string('supplier_reference', 100)->nullable();
            $t->uuid('stock_document_id')->nullable();
            $t->uuid('journal_entry_id')->nullable();
            $t->decimal('cost_total', 20, 4)->default(0);
            $t->timestampTz('posted_at')->nullable();
            $t->uuid('posted_by')->nullable();
            $t->timestampTz('cancelled_at')->nullable();
            $t->uuid('cancelled_by')->nullable();
            $t->string('cancel_reason', 1000)->nullable();
            $t->uuid('reversal_stock_document_id')->nullable();
            $t->date('reversal_date')->nullable();
        });
        Schema::create('purchase_receipt_lines', function (Blueprint $t): void {
            $this->line($t, 'purchase_receipts');
            $t->foreignUuid('order_line_id')->nullable()->constrained('purchase_order_lines')->restrictOnDelete();
            $t->string('lot_no', 64)->nullable();
            $t->date('expiry_date')->nullable();
            $t->jsonb('serial_numbers')->default('[]');
            $t->uuid('location_id')->nullable();
            $t->decimal('unit_cost', 20, 6)->nullable();
            $t->decimal('cost_total', 20, 4)->nullable();
            $t->index('order_line_id');
        });

        Schema::create('purchase_invoices', function (Blueprint $t): void {
            $this->header($t);
            $t->string('invoice_type', 8)->default('purchase');
            $t->string('supplier_invoice_no', 64)->nullable();
            $t->foreignUuid('order_id')->nullable()->constrained('purchase_orders')->restrictOnDelete();
            $t->foreignUuid('receipt_id')->nullable()->constrained('purchase_receipts')->restrictOnDelete();
            $t->uuid('return_id')->nullable();
            $t->uuid('original_invoice_id')->nullable();
            $t->boolean('receive_on_invoice')->default(false);
            $t->uuid('journal_entry_id')->nullable();
            $t->uuid('reversal_journal_entry_id')->nullable();
            $t->decimal('paid_amount', 20, 4)->default(0);
            $t->decimal('balance_due', 20, 4)->default(0);
            $t->string('match_status', 16)->nullable();
            $t->string('match_override_reason', 1000)->nullable();
            $t->uuid('match_override_by')->nullable();
            $t->uuid('approval_request_id')->nullable();
            $t->string('approval_comment', 1000)->nullable();
            $t->timestampTz('approved_at')->nullable();
            $t->uuid('approved_by')->nullable();
            $t->timestampTz('booked_at')->nullable();
            $t->uuid('booked_by')->nullable();
            $t->timestampTz('reversed_at')->nullable();
            $t->uuid('reversed_by')->nullable();
            $t->date('reversal_date')->nullable();
            $t->string('reversal_reason', 1000)->nullable();
            $t->string('e_document_status', 32)->nullable();
            $t->uuid('e_document_uuid')->nullable();
        });
        Schema::table('purchase_invoices', function (Blueprint $t): void {
            $t->foreign('original_invoice_id')->references('id')->on('purchase_invoices')->restrictOnDelete();
        });
        Schema::table('purchase_receipts', function (Blueprint $t): void {
            $t->foreign('invoice_id')->references('id')->on('purchase_invoices')->nullOnDelete();
        });
        Schema::create('purchase_invoice_lines', function (Blueprint $t): void {
            $this->line($t, 'purchase_invoices');
            $t->foreignUuid('order_line_id')->nullable()->constrained('purchase_order_lines')->restrictOnDelete();
            $t->foreignUuid('receipt_line_id')->nullable()->constrained('purchase_receipt_lines')->restrictOnDelete();
            $t->uuid('original_line_id')->nullable();
            $t->string('match_status', 16)->nullable();
            $t->jsonb('match_details')->nullable();
            $t->decimal('net_local', 20, 4)->default(0);
            $t->decimal('grni_amount', 20, 4)->default(0);
            $t->decimal('variance_amount', 20, 4)->default(0);
            $t->decimal('expense_amount', 20, 4)->default(0);
            $t->index('order_line_id');
            $t->index('receipt_line_id');
        });
        Schema::table('purchase_invoice_lines', function (Blueprint $t): void {
            $t->foreign('original_line_id')->references('id')->on('purchase_invoice_lines')->restrictOnDelete();
        });

        Schema::create('purchase_returns', function (Blueprint $t): void {
            $this->header($t);
            $t->foreignUuid('invoice_id')->nullable()->constrained('purchase_invoices')->restrictOnDelete();
            $t->foreignUuid('receipt_id')->nullable()->constrained('purchase_receipts')->restrictOnDelete();
            $t->string('reason', 1000)->nullable();
            $t->uuid('stock_document_id')->nullable();
            $t->uuid('journal_entry_id')->nullable();
            $t->foreignUuid('debit_invoice_id')->nullable()->constrained('purchase_invoices')->nullOnDelete();
            $t->timestampTz('approved_at')->nullable();
            $t->uuid('approved_by')->nullable();
            $t->timestampTz('shipped_at')->nullable();
            $t->uuid('shipped_by')->nullable();
            $t->timestampTz('debited_at')->nullable();
            $t->uuid('debited_by')->nullable();
            $t->timestampTz('cancelled_at')->nullable();
        });
        Schema::create('purchase_return_lines', function (Blueprint $t): void {
            $this->line($t, 'purchase_returns');
            $t->foreignUuid('invoice_line_id')->nullable()->constrained('purchase_invoice_lines')->restrictOnDelete();
            $t->foreignUuid('receipt_line_id')->nullable()->constrained('purchase_receipt_lines')->restrictOnDelete();
            $t->string('lot_no', 64)->nullable();
            $t->jsonb('serial_numbers')->default('[]');
            $t->decimal('unit_cost', 20, 6)->nullable();
            $t->decimal('cost_total', 20, 4)->nullable();
            $t->decimal('receipt_cost', 20, 4)->nullable();
            $t->index('invoice_line_id');
            $t->index('receipt_line_id');
        });
        Schema::table('purchase_invoices', function (Blueprint $t): void {
            $t->foreign('return_id')->references('id')->on('purchase_returns')->nullOnDelete();
        });

        Schema::create('purchase_payable_applications', function (Blueprint $t): void {
            $t->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $t->uuid('company_id');
            $t->foreignUuid('invoice_id')->constrained('purchase_invoices')->restrictOnDelete();
            $t->string('reference', 100);
            $t->decimal('amount', 20, 4);
            $t->timestampTz('applied_at');
            $t->timestampTz('unapplied_at')->nullable();
            $t->uuid('created_by')->nullable();
            $t->timestampsTz();
            $t->unique(['company_id', 'invoice_id', 'reference']);
        });

        foreach (['purchase_requests', 'purchase_rfqs'] as $table) {
            DB::statement("CREATE UNIQUE INDEX {$table}_number_unique ON {$table} (company_id, number) WHERE number IS NOT NULL");
        }

        foreach (['purchase_request_lines', 'purchase_rfq_lines'] as $lines) {
            DB::statement("ALTER TABLE {$lines} ADD CONSTRAINT {$lines}_quantity_positive CHECK (quantity > 0 AND base_quantity > 0)");
        }

        DB::statement('ALTER TABLE purchase_request_lines ADD CONSTRAINT purchase_request_lines_price_check CHECK (estimated_price >= 0 AND estimated_total >= 0)');
        DB::statement('ALTER TABLE purchase_rfq_quotes ADD CONSTRAINT purchase_rfq_quotes_price_check CHECK (unit_price >= 0 AND discount_percent BETWEEN 0 AND 100)');

        foreach (self::HEADERS as $table => $lines) {
            $unique = $table === 'purchase_invoices' ? '(company_id, invoice_type, number)' : '(company_id, number)';
            DB::statement("CREATE UNIQUE INDEX {$table}_number_unique ON {$table} {$unique} WHERE number IS NOT NULL");
            DB::statement("CREATE INDEX {$table}_party_name_trgm ON {$table} USING gin (party_name gin_trgm_ops)");
            DB::statement("ALTER TABLE {$table} ADD CONSTRAINT {$table}_fx_rate_positive CHECK (fx_rate > 0)");
            DB::statement("ALTER TABLE {$table} ADD CONSTRAINT {$table}_totals_check CHECK (total = subtotal - discount_total + tax_total AND withholding_total >= 0 AND withholding_total <= tax_total)");
            DB::statement("ALTER TABLE {$lines} ADD CONSTRAINT {$lines}_quantity_positive CHECK (quantity > 0 AND base_quantity > 0)");
            DB::statement("ALTER TABLE {$lines} ADD CONSTRAINT {$lines}_amounts_check CHECK (discount_percent BETWEEN 0 AND 100 AND unit_price >= 0 AND discount_amount >= 0 AND line_total = net_amount + tax_amount AND withholding_amount >= 0 AND withholding_amount <= tax_amount AND withholding_rate BETWEEN 0 AND 100)");
        }

        // A supplier's invoice number is booked once: drafts, pending and booked invoices hold it;
        // cancelled and reversed ones release it so a corrected invoice can be entered again.
        DB::statement("CREATE UNIQUE INDEX purchase_invoices_supplier_no_unique ON purchase_invoices (company_id, party_id, supplier_invoice_no)
            WHERE supplier_invoice_no IS NOT NULL AND invoice_type = 'purchase' AND status NOT IN ('cancelled', 'reversed')");

        DB::statement("ALTER TABLE purchase_requests ADD CONSTRAINT purchase_requests_status_check CHECK (status IN ('draft','pending_approval','approved','rejected','partially_ordered','ordered','cancelled'))");
        DB::statement("ALTER TABLE purchase_rfqs ADD CONSTRAINT purchase_rfqs_status_check CHECK (status IN ('draft','sent','collecting','awarded','cancelled'))");
        DB::statement("ALTER TABLE purchase_rfq_suppliers ADD CONSTRAINT purchase_rfq_suppliers_status_check CHECK (status IN ('invited','responded','declined'))");
        DB::statement("ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check CHECK (status IN ('draft','pending_approval','approved','sent','partially_received','received','partially_invoiced','invoiced','closed','cancelled'))");
        DB::statement("ALTER TABLE purchase_receipts ADD CONSTRAINT purchase_receipts_status_check CHECK (status IN ('draft','posted','cancelled'))");
        DB::statement("ALTER TABLE purchase_invoices ADD CONSTRAINT purchase_invoices_status_check CHECK (status IN ('draft','pending_approval','booked','partially_paid','paid','cancelled','reversed'))");
        DB::statement("ALTER TABLE purchase_returns ADD CONSTRAINT purchase_returns_status_check CHECK (status IN ('draft','approved','shipped','debited','cancelled'))");
        DB::statement("ALTER TABLE purchase_invoices ADD CONSTRAINT purchase_invoices_type_check CHECK (invoice_type IN ('purchase','return'))");
        DB::statement("ALTER TABLE purchase_invoices ADD CONSTRAINT purchase_invoices_match_check CHECK (match_status IS NULL OR match_status IN ('matched','qty_variance','price_variance','unmatched'))");
        DB::statement("ALTER TABLE purchase_invoice_lines ADD CONSTRAINT purchase_invoice_lines_match_check CHECK (match_status IS NULL OR match_status IN ('matched','qty_variance','price_variance','unmatched'))");
        DB::statement('ALTER TABLE purchase_order_lines ADD CONSTRAINT purchase_order_lines_progress_check CHECK (received_quantity >= 0 AND invoiced_quantity >= 0)');
        DB::statement('ALTER TABLE purchase_payable_applications ADD CONSTRAINT purchase_payable_applications_amount_positive CHECK (amount > 0)');
        DB::statement("ALTER TABLE purchase_receipts ADD CONSTRAINT purchase_receipts_posted_check CHECK (status = 'draft' OR (status = 'cancelled' AND posted_at IS NULL) OR (number IS NOT NULL AND stock_document_id IS NOT NULL))");
        DB::statement(<<<'SQL'
            ALTER TABLE purchase_invoices ADD CONSTRAINT purchase_invoices_balance_check CHECK (
                paid_amount >= 0 AND balance_due >= 0 AND paid_amount <= total - withholding_total
                AND (status IN ('draft', 'pending_approval', 'cancelled') OR (number IS NOT NULL AND journal_entry_id IS NOT NULL))
                AND (status NOT IN ('booked', 'partially_paid', 'paid') OR balance_due = total - withholding_total - paid_amount)
                AND (status <> 'reversed' OR (paid_amount = 0 AND balance_due = 0))
            )
            SQL);
    }

    public function down(): void
    {
        Schema::table('purchase_invoices', function (Blueprint $t): void {
            $t->dropForeign(['return_id']);
        });
        Schema::table('purchase_receipts', function (Blueprint $t): void {
            $t->dropForeign(['invoice_id']);
        });
        Schema::table('purchase_rfq_lines', function (Blueprint $t): void {
            $t->dropForeign(['awarded_quote_id']);
        });

        foreach ([
            'purchase_payable_applications', 'purchase_return_lines', 'purchase_returns', 'purchase_invoice_lines', 'purchase_invoices',
            'purchase_receipt_lines', 'purchase_receipts', 'purchase_order_lines', 'purchase_orders', 'purchase_rfq_quotes',
            'purchase_rfq_suppliers', 'purchase_rfq_lines', 'purchase_rfqs', 'purchase_request_lines', 'purchase_requests',
        ] as $table) {
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
        $t->uuid('warehouse_id')->nullable();
        $t->uuid('cost_center_id')->nullable();
        $t->uuid('project_id')->nullable();
        $t->text('notes')->nullable();
        $t->text('internal_notes')->nullable();
        $t->string('source_type', 32)->nullable();
        $t->uuid('source_id')->nullable();

        foreach (['subtotal', 'discount_total', 'tax_total', 'total', 'withholding_total'] as $column) {
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

    private function baseLine(Blueprint $t, string $header): void
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
        $t->unique(['document_id', 'line_no']);
        $t->index(['company_id', 'item_id']);
    }

    private function line(Blueprint $t, string $header): void
    {
        $this->baseLine($t, $header);
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
        $t->uuid('withholding_code_id')->nullable();
        $t->decimal('withholding_rate', 7, 4)->default(0);
        $t->decimal('withholding_amount', 20, 4)->default(0);
        $t->decimal('line_total', 20, 4)->default(0);
        $t->uuid('warehouse_id')->nullable();
        $t->uuid('source_line_id')->nullable();
        $t->string('price_source', 32)->nullable();
    }
};
