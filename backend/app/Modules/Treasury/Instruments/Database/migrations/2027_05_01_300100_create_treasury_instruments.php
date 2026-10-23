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
        Schema::create('treasury_instruments', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('company_id')->constrained('companies')->restrictOnDelete();
            $table->string('kind', 10);
            $table->string('direction', 10);
            $table->string('instrument_number', 100);
            $table->foreignUuid('party_id')->constrained('parties')->restrictOnDelete();
            $table->decimal('amount', 20, 4);
            $table->char('currency_code', 3);
            $table->decimal('fx_rate', 20, 6);
            $table->decimal('local_amount', 20, 4)->default(0);
            $table->foreignUuid('portfolio_account_id')->nullable()->constrained('accounts')->restrictOnDelete();
            $table->date('issue_date');
            $table->date('due_date');
            $table->string('bank_name')->nullable();
            $table->string('drawer')->nullable();
            $table->string('reference')->nullable();
            $table->string('status', 20)->default('draft');
            $table->string('number', 50)->nullable();
            $table->foreignUuid('journal_entry_id')->nullable()->constrained('journal_entries')->restrictOnDelete();
            $table->unsignedInteger('version')->default(1);
            $table->uuid('created_by')->nullable();
            $table->timestampsTz();
            $table->unique(['company_id', 'direction', 'kind', 'instrument_number']);
            $table->index(['company_id', 'status', 'due_date']);
        });
        Schema::create('treasury_instrument_allocations', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('company_id')->index();
            $table->foreignUuid('instrument_id')->constrained('treasury_instruments')->restrictOnDelete();
            $table->string('purpose', 10)->default('origin');
            $table->string('invoice_module', 20);
            $table->uuid('invoice_id');
            $table->decimal('amount', 20, 4);
            $table->decimal('carrying_local', 20, 4)->default(0);
            $table->string('settlement_reference', 100);
            $table->unique(['instrument_id', 'purpose', 'invoice_module', 'invoice_id'], 'treasury_instrument_allocation_unique');
        });
        Schema::create('treasury_instrument_events', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('company_id')->index();
            $table->foreignUuid('instrument_id')->constrained('treasury_instruments')->restrictOnDelete();
            $table->unsignedInteger('sequence');
            $table->string('action', 20);
            $table->string('from_status', 20);
            $table->string('to_status', 20);
            $table->date('document_date');
            $table->foreignUuid('journal_entry_id')->nullable()->constrained('journal_entries')->restrictOnDelete();
            $table->foreignUuid('movement_id')->nullable()->constrained('treasury_movements')->restrictOnDelete();
            $table->text('reason')->nullable();
            $table->uuid('actor_id')->nullable();
            $table->jsonb('metadata')->nullable();
            $table->timestampTz('created_at');
            $table->unique(['instrument_id', 'sequence']);
        });
        DB::statement("ALTER TABLE treasury_instruments ADD CHECK (kind IN ('cheque','note')), ADD CHECK (direction IN ('received','issued')), ADD CHECK (amount > 0 AND fx_rate > 0), ADD CHECK (due_date >= issue_date), ADD CHECK (status IN ('draft','portfolio','issued','collection','pledged','cleared','endorsed','dishonoured','returned'))");
        DB::statement('ALTER TABLE treasury_instrument_allocations ADD CHECK (amount > 0)');
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION guard_treasury_instrument() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF OLD.status <> 'draft' THEN
                    IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - ARRAY['status','version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','version','updated_at']) THEN
                        RAISE EXCEPTION 'Posted instruments are immutable' USING ERRCODE = '23514';
                    END IF;
                END IF;
                IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
                RETURN NEW;
            END $$;
            CREATE TRIGGER treasury_instrument_guard BEFORE UPDATE OR DELETE ON treasury_instruments FOR EACH ROW EXECUTE FUNCTION guard_treasury_instrument();
            CREATE OR REPLACE FUNCTION guard_treasury_instrument_event() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'Instrument history is immutable' USING ERRCODE = '23514'; END $$;
            CREATE TRIGGER treasury_instrument_event_guard BEFORE UPDATE OR DELETE ON treasury_instrument_events FOR EACH ROW EXECUTE FUNCTION guard_treasury_instrument_event();
            CREATE OR REPLACE FUNCTION guard_treasury_instrument_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE current_status text;
            BEGIN
                SELECT status INTO current_status FROM treasury_instruments WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.instrument_id ELSE NEW.instrument_id END;
                IF TG_OP = 'INSERT' THEN
                    IF NOT ((current_status = 'draft' AND NEW.purpose = 'origin') OR (current_status = 'portfolio' AND NEW.purpose = 'endorse')) THEN
                        RAISE EXCEPTION 'Instrument allocations cannot be added in this state' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END IF;
                IF current_status <> 'draft' AND NOT (TG_OP = 'UPDATE' AND current_status = 'portfolio' AND OLD.purpose = 'endorse'
                    AND (to_jsonb(NEW) - 'carrying_local') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'carrying_local')) THEN
                    RAISE EXCEPTION 'Posted instrument allocations are immutable' USING ERRCODE = '23514';
                END IF;
                IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
                RETURN NEW;
            END $$;
            CREATE TRIGGER treasury_instrument_allocation_guard BEFORE INSERT OR UPDATE OR DELETE ON treasury_instrument_allocations FOR EACH ROW EXECUTE FUNCTION guard_treasury_instrument_allocation();
            SQL);
    }

    public function down(): void
    {
        Schema::dropIfExists('treasury_instrument_events');
        Schema::dropIfExists('treasury_instrument_allocations');
        Schema::dropIfExists('treasury_instruments');
        DB::statement('DROP FUNCTION IF EXISTS guard_treasury_instrument_allocation()');
        DB::statement('DROP FUNCTION IF EXISTS guard_treasury_instrument_event()');
        DB::statement('DROP FUNCTION IF EXISTS guard_treasury_instrument()');
    }
};
