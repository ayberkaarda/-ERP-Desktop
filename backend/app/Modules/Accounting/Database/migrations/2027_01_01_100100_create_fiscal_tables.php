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
        DB::statement('CREATE EXTENSION IF NOT EXISTS btree_gist');

        Schema::create('fiscal_years', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id');
            $table->string('code', 16);
            $table->string('name', 200);
            $table->date('start_date');
            $table->date('end_date');
            $table->string('status', 16)->default('open');
            $table->timestampTz('closed_at')->nullable();
            $table->uuid('closed_by')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestampsTz();

            $table->unique(['company_id', 'code']);
        });

        DB::statement("ALTER TABLE fiscal_years ADD CONSTRAINT fiscal_years_status_check CHECK (status IN ('open', 'closed'))");
        DB::statement('ALTER TABLE fiscal_years ADD CONSTRAINT fiscal_years_dates_check CHECK (end_date >= start_date)');
        DB::statement("ALTER TABLE fiscal_years ADD CONSTRAINT fiscal_years_no_overlap EXCLUDE USING gist (company_id WITH =, daterange(start_date, end_date, '[]') WITH &&)");

        Schema::create('accounting_periods', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id');
            $table->uuid('fiscal_year_id');
            $table->smallInteger('number');
            $table->date('start_date');
            $table->date('end_date');
            $table->string('status', 16)->default('open');
            $table->timestampTz('closed_at')->nullable();
            $table->uuid('closed_by')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestampsTz();

            $table->unique(['fiscal_year_id', 'number']);
            $table->index(['company_id', 'start_date']);
            $table->foreign('fiscal_year_id')->references('id')->on('fiscal_years')->cascadeOnDelete();
        });

        DB::statement('ALTER TABLE accounting_periods ADD CONSTRAINT accounting_periods_number_check CHECK (number BETWEEN 1 AND 13)');
        DB::statement("ALTER TABLE accounting_periods ADD CONSTRAINT accounting_periods_status_check CHECK (status IN ('open', 'soft_closed', 'closed'))");
        DB::statement('ALTER TABLE accounting_periods ADD CONSTRAINT accounting_periods_dates_check CHECK (end_date >= start_date)');
        // Period 13 is the zero-length year-end adjustment period and shares its day with period 12.
        DB::statement("ALTER TABLE accounting_periods ADD CONSTRAINT accounting_periods_no_overlap EXCLUDE USING gist (company_id WITH =, daterange(start_date, end_date, '[]') WITH &&) WHERE (number <= 12)");

        // Regular periods 1..n tile the year without gaps; period 13 sits on the last day. Deferred,
        // so a year and its periods can be written (or regenerated) in any order within a transaction.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION acc_check_period_tiling(p_year uuid) RETURNS void LANGUAGE plpgsql AS $$
            DECLARE
                y record;
                r record;
                expected_start date;
                n int := 0;
            BEGIN
                SELECT id, company_id, start_date, end_date INTO y FROM fiscal_years WHERE id = p_year;
                IF NOT FOUND THEN
                    RETURN;
                END IF;

                expected_start := y.start_date;

                FOR r IN SELECT number, company_id, start_date, end_date FROM accounting_periods
                         WHERE fiscal_year_id = p_year AND number <= 12 ORDER BY number LOOP
                    n := n + 1;
                    IF r.number <> n OR r.start_date <> expected_start OR r.company_id <> y.company_id THEN
                        RAISE EXCEPTION USING ERRCODE = 'KA007',
                            MESSAGE = format('accounting periods of fiscal year %s must tile the year without gaps (period %s)', p_year, r.number);
                    END IF;
                    expected_start := r.end_date + 1;
                END LOOP;

                IF n = 0 OR expected_start - 1 <> y.end_date THEN
                    RAISE EXCEPTION USING ERRCODE = 'KA007',
                        MESSAGE = format('accounting periods of fiscal year %s must cover it from start to end', p_year);
                END IF;

                IF EXISTS (SELECT 1 FROM accounting_periods WHERE fiscal_year_id = p_year AND number = 13
                           AND (start_date <> y.end_date OR end_date <> y.end_date OR company_id <> y.company_id)) THEN
                    RAISE EXCEPTION USING ERRCODE = 'KA007',
                        MESSAGE = format('period 13 of fiscal year %s must be the last day of the year', p_year);
                END IF;
            END;
            $$;

            CREATE OR REPLACE FUNCTION acc_periods_tiling_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP IN ('UPDATE', 'DELETE') THEN
                    PERFORM acc_check_period_tiling(OLD.fiscal_year_id);
                END IF;
                IF TG_OP IN ('INSERT', 'UPDATE') THEN
                    PERFORM acc_check_period_tiling(NEW.fiscal_year_id);
                END IF;
                RETURN NULL;
            END;
            $$;

            CREATE OR REPLACE FUNCTION acc_years_tiling_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                PERFORM acc_check_period_tiling(NEW.id);
                RETURN NULL;
            END;
            $$;

            CREATE CONSTRAINT TRIGGER accounting_periods_tiling
                AFTER INSERT OR UPDATE OR DELETE ON accounting_periods
                DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION acc_periods_tiling_trigger();

            CREATE CONSTRAINT TRIGGER fiscal_years_tiling
                AFTER INSERT OR UPDATE OF start_date, end_date ON fiscal_years
                DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION acc_years_tiling_trigger();
            SQL);
    }

    public function down(): void
    {
        Schema::dropIfExists('accounting_periods');
        Schema::dropIfExists('fiscal_years');
        DB::unprepared('DROP FUNCTION IF EXISTS acc_periods_tiling_trigger(); DROP FUNCTION IF EXISTS acc_years_tiling_trigger(); DROP FUNCTION IF EXISTS acc_check_period_tiling(uuid);');
    }
};
