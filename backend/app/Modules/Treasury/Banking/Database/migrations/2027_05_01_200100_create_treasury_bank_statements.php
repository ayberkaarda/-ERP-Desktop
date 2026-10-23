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
        Schema::create('treasury_bank_statements', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('company_id')->constrained('companies')->restrictOnDelete();
            $table->foreignUuid('account_id')->constrained('treasury_accounts')->restrictOnDelete();
            $table->string('format', 10);
            $table->string('bank_reference')->default('');
            $table->string('account_reference')->default('');
            $table->char('currency_code', 3);
            $table->date('start_date');
            $table->date('end_date');
            $table->decimal('opening_balance', 20, 4);
            $table->decimal('closing_balance', 20, 4);
            $table->char('content_digest', 64);
            $table->string('status', 20)->default('imported');
            $table->unsignedInteger('version')->default(1);
            $table->uuid('created_by')->nullable();
            $table->timestampsTz();
            $table->unique(['company_id', 'account_id', 'content_digest']);
            $table->index(['company_id', 'account_id', 'start_date']);
        });
        Schema::create('treasury_bank_statement_lines', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('company_id')->index();
            $table->foreignUuid('statement_id')->constrained('treasury_bank_statements')->restrictOnDelete();
            $table->unsignedInteger('line_no');
            $table->date('date');
            $table->date('value_date');
            $table->decimal('amount', 20, 4);
            $table->string('reference')->default('');
            $table->text('description');
            $table->foreignUuid('payment_id')->nullable()->constrained('treasury_payments')->restrictOnDelete();
            $table->foreignUuid('movement_id')->nullable()->constrained('treasury_movements')->restrictOnDelete();
            $table->unique(['statement_id', 'line_no']);
            $table->unique(['company_id', 'payment_id']);
            $table->unique(['company_id', 'movement_id']);
        });
        DB::statement("ALTER TABLE treasury_bank_statements ADD CHECK (status IN ('imported','reconciled')), ADD CHECK (format IN ('csv','mt940')), ADD CHECK (end_date >= start_date)");
        DB::statement('ALTER TABLE treasury_bank_statement_lines ADD CHECK (amount <> 0)');
        DB::statement("CREATE UNIQUE INDEX treasury_statement_bank_identity ON treasury_bank_statements(company_id,account_id,bank_reference,start_date,end_date) WHERE bank_reference <> ''");
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION guard_treasury_statement() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - ARRAY['status','version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','version','updated_at']) THEN
                    RAISE EXCEPTION 'Imported bank statements are immutable' USING ERRCODE = '23514';
                END IF;
                RETURN NEW;
            END $$;
            CREATE TRIGGER treasury_statement_guard BEFORE UPDATE OR DELETE ON treasury_bank_statements FOR EACH ROW EXECUTE FUNCTION guard_treasury_statement();
            CREATE OR REPLACE FUNCTION guard_treasury_statement_line() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - ARRAY['payment_id','movement_id']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['payment_id','movement_id']) THEN
                    RAISE EXCEPTION 'Imported bank statement lines are immutable' USING ERRCODE = '23514';
                END IF;
                IF EXISTS (SELECT 1 FROM treasury_bank_statements WHERE id = OLD.statement_id AND status = 'reconciled') THEN
                    RAISE EXCEPTION 'Reopen the reconciled statement before changing matches' USING ERRCODE = '23514';
                END IF;
                RETURN NEW;
            END $$;
            CREATE TRIGGER treasury_statement_line_guard BEFORE UPDATE OR DELETE ON treasury_bank_statement_lines FOR EACH ROW EXECUTE FUNCTION guard_treasury_statement_line();
            SQL);
    }

    public function down(): void
    {
        Schema::dropIfExists('treasury_bank_statement_lines');
        Schema::dropIfExists('treasury_bank_statements');
        DB::statement('DROP FUNCTION IF EXISTS guard_treasury_statement_line()');
        DB::statement('DROP FUNCTION IF EXISTS guard_treasury_statement()');
    }
};
