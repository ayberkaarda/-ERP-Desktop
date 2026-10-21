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
        Schema::create('journal_entries', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id');
            $table->string('number', 64)->nullable();
            $table->string('entry_type', 16);
            $table->date('entry_date');
            $table->uuid('period_id');
            $table->uuid('fiscal_year_id');
            $table->text('description')->nullable();
            $table->string('status', 16)->default('draft');
            $table->string('source_type', 64)->nullable();
            $table->uuid('source_id')->nullable();
            // "<source_type>|<source_id>|<purpose>": one booked entry per key, so a document never posts twice.
            $table->string('posting_key', 255)->nullable();
            $table->uuid('reverses_id')->nullable();
            $table->uuid('reversed_by_id')->nullable();
            $table->text('reversal_reason')->nullable();
            $table->timestampTz('posted_at')->nullable();
            $table->uuid('posted_by')->nullable();
            $table->uuid('created_by')->nullable();
            $table->decimal('total_debit', 20, 4)->default(0);
            $table->decimal('total_credit', 20, 4)->default(0);
            $table->unsignedInteger('version')->default(1);
            $table->timestampsTz();

            $table->unique(['company_id', 'number']);
            $table->index(['company_id', 'entry_date']);
            $table->index(['company_id', 'status']);
            $table->index(['period_id', 'status']);
            $table->index(['company_id', 'source_type', 'source_id']);
            $table->foreign('period_id')->references('id')->on('accounting_periods')->restrictOnDelete();
            $table->foreign('fiscal_year_id')->references('id')->on('fiscal_years')->restrictOnDelete();
        });

        // Self references need the primary key, which Schema::create adds after inline foreign keys.
        Schema::table('journal_entries', function (Blueprint $table): void {
            $table->foreign('reverses_id')->references('id')->on('journal_entries')->restrictOnDelete();
            $table->foreign('reversed_by_id')->references('id')->on('journal_entries')->restrictOnDelete();
        });

        DB::statement("ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_type_check CHECK (entry_type IN ('opening', 'general', 'receipt', 'payment', 'adjustment', 'revaluation', 'closing', 'reversal', 'system'))");
        DB::statement("ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_status_check CHECK (status IN ('draft', 'posted', 'reversed'))");
        DB::statement("ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_number_check CHECK ((status = 'draft') = (number IS NULL))");
        DB::statement('ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_totals_check CHECK (total_debit >= 0 AND total_credit >= 0)');
        DB::statement("CREATE UNIQUE INDEX journal_entries_posting_key_unique ON journal_entries (company_id, posting_key) WHERE posting_key IS NOT NULL AND status <> 'draft'");
        DB::statement('CREATE UNIQUE INDEX journal_entries_reverses_unique ON journal_entries (reverses_id) WHERE reverses_id IS NOT NULL');
        DB::statement('CREATE INDEX journal_entries_description_trgm ON journal_entries USING gin (description gin_trgm_ops)');

        Schema::create('journal_lines', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id');
            $table->uuid('entry_id');
            $table->unsignedInteger('line_no');
            $table->uuid('account_id');
            $table->decimal('debit', 20, 4)->default(0);
            $table->decimal('credit', 20, 4)->default(0);
            $table->char('currency_code', 3)->nullable();
            $table->decimal('fx_amount', 20, 4)->nullable();
            $table->decimal('fx_rate', 20, 6)->nullable();
            $table->uuid('party_id')->nullable();
            $table->uuid('cost_center_id')->nullable();
            $table->uuid('project_id')->nullable();
            $table->text('description')->nullable();
            $table->date('due_date')->nullable();
            $table->string('document_ref', 100)->nullable();

            $table->unique(['entry_id', 'line_no']);
            $table->index(['account_id', 'entry_id']);
            $table->index(['company_id', 'party_id']);
            $table->foreign('entry_id')->references('id')->on('journal_entries')->cascadeOnDelete();
            $table->foreign('account_id')->references('id')->on('accounts')->restrictOnDelete();
        });

        DB::statement('ALTER TABLE journal_lines ADD CONSTRAINT journal_lines_amount_check CHECK (debit >= 0 AND credit >= 0 AND (debit = 0 OR credit = 0) AND (debit + credit) > 0)');
        DB::statement('ALTER TABLE journal_lines ADD CONSTRAINT journal_lines_fx_check CHECK ((fx_amount IS NULL OR fx_amount >= 0) AND (fx_rate IS NULL OR fx_rate > 0))');

        Schema::create('account_balances', function (Blueprint $table): void {
            $table->uuid('company_id');
            $table->uuid('account_id');
            $table->uuid('period_id');
            $table->decimal('debit_total', 20, 4)->default(0);
            $table->decimal('credit_total', 20, 4)->default(0);
            $table->timestampTz('updated_at')->nullable();

            $table->primary(['account_id', 'period_id']);
            $table->index(['company_id', 'period_id']);
            $table->foreign('account_id')->references('id')->on('accounts')->restrictOnDelete();
            $table->foreign('period_id')->references('id')->on('accounting_periods')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('account_balances');
        Schema::dropIfExists('journal_lines');
        Schema::dropIfExists('journal_entries');
    }
};
