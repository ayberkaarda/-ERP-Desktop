<?php

declare(strict_types=1);
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE treasury_transfers ADD CONSTRAINT treasury_transfer_values CHECK(target_amount > 0 AND source_fx_rate > 0 AND target_fx_rate > 0 AND fee_amount >= 0 AND from_account_id <> to_account_id)');
        DB::statement("ALTER TABLE treasury_payment_plans ADD CONSTRAINT treasury_plan_values CHECK(amount > 0 AND direction IN ('receipt','payment') AND status IN ('scheduled','fulfilled','cancelled') AND ((status='fulfilled' AND payment_id IS NOT NULL) OR (status<>'fulfilled' AND payment_id IS NULL)))");
        DB::statement('ALTER TABLE treasury_movements ADD CONSTRAINT treasury_movement_signs CHECK((amount > 0 AND local_amount > 0) OR (amount < 0 AND local_amount < 0)), ADD CONSTRAINT treasury_movement_no_self_reversal CHECK(reverses_id IS NULL OR reverses_id <> id)');
        foreach (['treasury_payments', 'treasury_transfers'] as $table) {
            DB::statement("ALTER TABLE {$table} ADD CONSTRAINT {$table}_posted_fields CHECK(status NOT IN ('posted','reversed') OR (journal_entry_id IS NOT NULL AND number IS NOT NULL)), ADD CONSTRAINT {$table}_reversal_fields CHECK(status<>'reversed' OR (reversal_journal_entry_id IS NOT NULL AND reversal_date IS NOT NULL AND length(trim(reversal_reason))>0))");
        }
        foreach (['treasury_accounts', 'treasury_payments', 'treasury_transfers', 'treasury_payment_plans'] as $table) {
            DB::statement("ALTER TABLE {$table} ADD CONSTRAINT {$table}_version_positive CHECK(version > 0)");
        }
        DB::unprepared(<<<'SQL'
 CREATE OR REPLACE FUNCTION treasury_account_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.company_id,NEW.type,NEW.currency_code,NEW.gl_account_id,NEW.code) IS DISTINCT FROM (OLD.company_id,OLD.type,OLD.currency_code,OLD.gl_account_id,OLD.code) AND EXISTS(SELECT 1 FROM treasury_movements m WHERE m.account_id=OLD.id) THEN RAISE EXCEPTION 'Used treasury account identity is immutable' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
 CREATE TRIGGER treasury_account_identity_guard BEFORE UPDATE ON treasury_accounts FOR EACH ROW EXECUTE FUNCTION treasury_account_identity();
 SQL);
    }

    public function down(): void
    {
        DB::statement('DROP TRIGGER IF EXISTS treasury_account_identity_guard ON treasury_accounts');
        DB::statement('DROP FUNCTION IF EXISTS treasury_account_identity()');
        foreach (['treasury_accounts', 'treasury_payments', 'treasury_transfers', 'treasury_payment_plans'] as $table) {
            DB::statement("ALTER TABLE {$table} DROP CONSTRAINT IF EXISTS {$table}_version_positive");
        }foreach (['treasury_payments', 'treasury_transfers'] as $table) {
            DB::statement("ALTER TABLE {$table} DROP CONSTRAINT IF EXISTS {$table}_posted_fields, DROP CONSTRAINT IF EXISTS {$table}_reversal_fields");
        }DB::statement('ALTER TABLE treasury_movements DROP CONSTRAINT IF EXISTS treasury_movement_signs,DROP CONSTRAINT IF EXISTS treasury_movement_no_self_reversal');
        DB::statement('ALTER TABLE treasury_payment_plans DROP CONSTRAINT IF EXISTS treasury_plan_values');
        DB::statement('ALTER TABLE treasury_transfers DROP CONSTRAINT IF EXISTS treasury_transfer_values');
    }
};
