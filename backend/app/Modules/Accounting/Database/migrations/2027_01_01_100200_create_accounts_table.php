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
        Schema::create('accounts', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id');
            $table->string('code', 32);
            $table->string('name', 200);
            $table->uuid('parent_id')->nullable();
            $table->smallInteger('level')->default(1);
            $table->string('type', 16);
            $table->string('normal_balance', 8);
            $table->boolean('is_postable')->default(true);
            $table->boolean('is_active')->default(true);
            $table->boolean('is_system')->default(false);
            $table->smallInteger('tdhp_group')->nullable();
            $table->char('currency_code', 3)->nullable();
            $table->boolean('requires_party')->default(false);
            $table->boolean('requires_cost_center')->default(false);
            $table->boolean('requires_project')->default(false);
            $table->boolean('is_revaluable')->default(false);
            $table->text('notes')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestampsTz();

            $table->unique(['company_id', 'code']);
            $table->index(['company_id', 'parent_id']);
        });

        Schema::table('accounts', function (Blueprint $table): void {
            $table->foreign('parent_id')->references('id')->on('accounts')->restrictOnDelete();
        });

        DB::statement("ALTER TABLE accounts ADD CONSTRAINT accounts_type_check CHECK (type IN ('asset', 'liability', 'equity', 'revenue', 'expense', 'cost', 'memo'))");
        DB::statement("ALTER TABLE accounts ADD CONSTRAINT accounts_normal_balance_check CHECK (normal_balance IN ('debit', 'credit'))");
        DB::statement('ALTER TABLE accounts ADD CONSTRAINT accounts_tdhp_group_check CHECK (tdhp_group IS NULL OR tdhp_group BETWEEN 1 AND 9)');
        DB::statement('ALTER TABLE accounts ADD CONSTRAINT accounts_level_check CHECK (level >= 1)');
        DB::statement('CREATE INDEX accounts_code_pattern ON accounts (company_id, code text_pattern_ops)');
        DB::statement('CREATE INDEX accounts_name_trgm ON accounts USING gin (name gin_trgm_ops)');

        // Tree integrity: parents belong to the same company, are never postable, and no cycles.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION acc_accounts_tree_guard() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                par record;
            BEGIN
                IF TG_OP = 'UPDATE' AND NEW.company_id <> OLD.company_id THEN
                    RAISE EXCEPTION USING ERRCODE = 'KA006', MESSAGE = 'the company of an account cannot change';
                END IF;

                IF NEW.parent_id IS NOT NULL THEN
                    IF NEW.parent_id = NEW.id THEN
                        RAISE EXCEPTION USING ERRCODE = 'KA006', MESSAGE = format('account %s cannot be its own parent', NEW.code);
                    END IF;

                    SELECT company_id, is_postable INTO par FROM accounts WHERE id = NEW.parent_id FOR SHARE;
                    IF NOT FOUND OR par.company_id <> NEW.company_id THEN
                        RAISE EXCEPTION USING ERRCODE = 'KA006', MESSAGE = format('parent of account %s does not exist in its company', NEW.code);
                    END IF;
                    IF par.is_postable THEN
                        RAISE EXCEPTION USING ERRCODE = 'KA006', MESSAGE = format('parent of account %s is postable; only leaf accounts may be postable', NEW.code);
                    END IF;

                    IF TG_OP = 'UPDATE' AND NEW.parent_id IS DISTINCT FROM OLD.parent_id AND EXISTS (
                        WITH RECURSIVE up AS (
                            SELECT id, parent_id FROM accounts WHERE id = NEW.parent_id
                            UNION
                            SELECT a.id, a.parent_id FROM accounts a JOIN up ON a.id = up.parent_id
                        )
                        SELECT 1 FROM up WHERE id = NEW.id
                    ) THEN
                        RAISE EXCEPTION USING ERRCODE = 'KA006', MESSAGE = format('moving account %s there would create a cycle', NEW.code);
                    END IF;
                END IF;

                IF NEW.is_postable AND TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM accounts WHERE parent_id = NEW.id) THEN
                    RAISE EXCEPTION USING ERRCODE = 'KA006', MESSAGE = format('account %s has sub-accounts and cannot be postable', NEW.code);
                END IF;

                RETURN NEW;
            END;
            $$;

            CREATE TRIGGER accounts_tree_guard BEFORE INSERT OR UPDATE ON accounts
                FOR EACH ROW EXECUTE FUNCTION acc_accounts_tree_guard();
            SQL);
    }

    public function down(): void
    {
        Schema::dropIfExists('accounts');
        DB::unprepared('DROP FUNCTION IF EXISTS acc_accounts_tree_guard();');
    }
};
