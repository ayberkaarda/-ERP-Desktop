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
        Schema::create('treasury_accounts', function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->uuid('company_id')->index();
            $t->string('type', 10);
            $t->string('code', 30);
            $t->string('name', 200);
            $t->char('currency_code', 3);
            $t->uuid('gl_account_id');
            $t->string('bank_name', 200)->nullable();
            $t->string('branch', 100)->nullable();
            $t->string('iban', 34)->nullable();
            $t->boolean('is_active')->default(true);
            $t->boolean('allow_negative')->default(false);
            $t->integer('version')->default(1);
            $t->timestampsTz();
            $t->unique(['company_id', 'code']);
            $t->foreign('company_id')->references('id')->on('companies')->restrictOnDelete();
            $t->foreign('gl_account_id')->references('id')->on('accounts')->restrictOnDelete();
            $t->foreign('currency_code')->references('code')->on('currencies')->restrictOnDelete();
        });
        Schema::create('treasury_payments', function (Blueprint $t): void {
            $this->header($t);
            $t->string('direction', 10);
            $t->uuid('account_id');
            $t->uuid('party_id');
            $t->char('currency_code', 3);
            $t->decimal('amount', 20, 4);
            $t->decimal('fx_rate', 20, 6);
            $t->string('reference', 100)->nullable();
            $t->decimal('amount_local', 20, 4)->default(0);
            $t->decimal('allocated_local', 20, 4)->default(0);
            $t->decimal('advance_local', 20, 4)->default(0);
            $t->decimal('realized_fx', 20, 4)->default(0);
            $t->uuid('approval_request_id')->nullable();
            $t->foreign('account_id')->references('id')->on('treasury_accounts')->restrictOnDelete();
            $t->foreign('party_id')->references('id')->on('parties')->restrictOnDelete();
        });
        Schema::create('treasury_allocations', function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->uuid('company_id')->index();
            $t->uuid('payment_id');
            $t->string('invoice_module', 12);
            $t->uuid('invoice_id');
            $t->decimal('amount', 20, 4);
            $t->decimal('fx_rate', 20, 6);
            $t->decimal('carrying_amount', 20, 4)->default(0);
            $t->decimal('settlement_amount', 20, 4)->default(0);
            $t->decimal('realized_fx', 20, 4)->default(0);
            $t->timestampsTz();
            $t->unique(['payment_id', 'invoice_module', 'invoice_id']);
            $t->foreign('payment_id')->references('id')->on('treasury_payments')->restrictOnDelete();
        });
        Schema::create('treasury_transfers', function (Blueprint $t): void {
            $this->header($t);
            $t->uuid('from_account_id');
            $t->uuid('to_account_id');
            $t->decimal('amount', 20, 4);
            $t->decimal('target_amount', 20, 4);
            $t->decimal('source_fx_rate', 20, 6);
            $t->decimal('target_fx_rate', 20, 6);
            $t->decimal('fee_amount', 20, 4)->default(0);
            $t->uuid('expense_account_id')->nullable();
            $t->foreign('from_account_id')->references('id')->on('treasury_accounts')->restrictOnDelete();
            $t->foreign('to_account_id')->references('id')->on('treasury_accounts')->restrictOnDelete();
        });
        Schema::create('treasury_movements', function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->uuid('company_id')->index();
            $t->uuid('account_id');
            $t->date('document_date');
            $t->decimal('amount', 20, 4);
            $t->decimal('local_amount', 20, 4);
            $t->char('currency_code', 3);
            $t->string('source_type', 64);
            $t->uuid('source_id');
            $t->uuid('journal_entry_id');
            $t->uuid('reverses_id')->nullable();
            $t->timestampsTz();
            $t->unique(['company_id', 'account_id', 'source_type', 'source_id'], 'treasury_movement_source_unique');
            $t->foreign('account_id')->references('id')->on('treasury_accounts')->restrictOnDelete();
            $t->foreign('journal_entry_id')->references('id')->on('journal_entries')->restrictOnDelete();
            $t->index(['company_id', 'account_id', 'document_date']);
        });
        Schema::create('treasury_payment_plans', function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->uuid('company_id')->index();
            $t->uuid('party_id');
            $t->uuid('account_id')->nullable();
            $t->string('direction', 10);
            $t->char('currency_code', 3);
            $t->decimal('amount', 20, 4);
            $t->date('due_date');
            $t->text('description')->nullable();
            $t->string('status', 12)->default('scheduled');
            $t->uuid('payment_id')->nullable()->unique();
            $t->integer('version')->default(1);
            $t->timestampsTz();
            $t->foreign('party_id')->references('id')->on('parties')->restrictOnDelete();
            $t->foreign('account_id')->references('id')->on('treasury_accounts')->restrictOnDelete();
            $t->foreign('payment_id')->references('id')->on('treasury_payments')->restrictOnDelete();
        });
        foreach (['treasury_payments', 'treasury_transfers'] as $table) {
            DB::statement("ALTER TABLE {$table} ADD CONSTRAINT {$table}_amount_positive CHECK(amount > 0), ADD CONSTRAINT {$table}_status_valid CHECK(status IN ('draft','pending_approval','approved','posted','reversed','cancelled'))");
        }
        DB::statement("ALTER TABLE treasury_accounts ADD CONSTRAINT treasury_account_type_valid CHECK(type IN ('cash','bank','pos'))");
        DB::statement("ALTER TABLE treasury_payments ADD CONSTRAINT treasury_payment_direction CHECK(direction IN ('receipt','payment')), ADD CONSTRAINT treasury_payment_fx_positive CHECK(fx_rate > 0)");
        DB::statement("ALTER TABLE treasury_allocations ADD CONSTRAINT treasury_allocation_positive CHECK(amount > 0 AND fx_rate > 0), ADD CONSTRAINT treasury_allocation_module CHECK(invoice_module IN ('sales','purchasing'))");
        DB::unprepared(<<<'SQL'
 CREATE OR REPLACE FUNCTION treasury_money_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Treasury movements are immutable' USING ERRCODE='23514'; END IF;
 RAISE EXCEPTION 'Treasury movements are immutable' USING ERRCODE='23514'; END $$;
 CREATE TRIGGER treasury_movements_immutable BEFORE UPDATE OR DELETE ON treasury_movements FOR EACH ROW EXECUTE FUNCTION treasury_money_immutable();
 CREATE OR REPLACE FUNCTION treasury_document_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.status IN ('posted','reversed') THEN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Posted treasury documents are immutable' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(NEW) - ARRAY['status','version','updated_at','reversal_journal_entry_id','reversal_date','reversal_reason']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','version','updated_at','reversal_journal_entry_id','reversal_date','reversal_reason']) OR NOT(OLD.status='posted' AND NEW.status='reversed' AND NEW.reversal_journal_entry_id IS NOT NULL AND NEW.reversal_date IS NOT NULL AND length(trim(NEW.reversal_reason))>0) THEN RAISE EXCEPTION 'Posted treasury documents are immutable' USING ERRCODE='23514'; END IF;
 END IF; RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END $$;
 CREATE TRIGGER treasury_payments_immutable BEFORE UPDATE OR DELETE ON treasury_payments FOR EACH ROW EXECUTE FUNCTION treasury_document_immutable();
 CREATE TRIGGER treasury_transfers_immutable BEFORE UPDATE OR DELETE ON treasury_transfers FOR EACH ROW EXECUTE FUNCTION treasury_document_immutable();
 CREATE OR REPLACE FUNCTION treasury_allocation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE p_status text; p_company uuid; BEGIN
 IF TG_OP <> 'INSERT' THEN SELECT status INTO p_status FROM treasury_payments WHERE id=OLD.payment_id; IF p_status IN ('posted','reversed') THEN RAISE EXCEPTION 'Posted allocations are immutable' USING ERRCODE='23514'; END IF; END IF;
 IF TG_OP <> 'DELETE' THEN SELECT status,company_id INTO p_status,p_company FROM treasury_payments WHERE id=NEW.payment_id; IF p_status IN ('posted','reversed') OR p_company IS DISTINCT FROM NEW.company_id THEN RAISE EXCEPTION 'Posted or foreign allocations are immutable' USING ERRCODE='23514'; END IF; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END $$;
 CREATE TRIGGER treasury_allocations_immutable BEFORE INSERT OR UPDATE OR DELETE ON treasury_allocations FOR EACH ROW EXECUTE FUNCTION treasury_allocation_immutable();
 SQL);
    }

    private function header(Blueprint $t): void
    {
        $t->uuid('id')->primary();
        $t->uuid('company_id')->index();
        $t->string('number', 40)->nullable();
        $t->date('document_date');
        $t->string('status', 20)->default('draft');
        $t->text('description')->nullable();
        $t->uuid('journal_entry_id')->nullable();
        $t->uuid('reversal_journal_entry_id')->nullable();
        $t->date('reversal_date')->nullable();
        $t->text('reversal_reason')->nullable();
        $t->uuid('created_by')->nullable();
        $t->integer('version')->default(1);
        $t->timestampsTz();
        $t->unique(['company_id', 'number']);
        $t->foreign('company_id')->references('id')->on('companies')->restrictOnDelete();
    }

    public function down(): void
    {
        foreach (['treasury_payment_plans', 'treasury_movements', 'treasury_transfers', 'treasury_allocations', 'treasury_payments', 'treasury_accounts'] as $t) {
            Schema::dropIfExists($t);
        }DB::unprepared('DROP FUNCTION IF EXISTS treasury_allocation_immutable(); DROP FUNCTION IF EXISTS treasury_document_immutable(); DROP FUNCTION IF EXISTS treasury_money_immutable()');
    }
};
