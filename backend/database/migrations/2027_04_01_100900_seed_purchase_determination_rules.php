<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Default determination rules of the purchasing events added with purchasing, for companies that
 * already exist (new companies get them from Accounting's bootstrap): purchase.goods_received ->
 * 381 Gider Tahakkukları (goods received not invoiced), purchase.price_variance -> 621. A company
 * whose chart lacks the account (or has it as a heading) gets no rule. Idempotent through the
 * partial unique index (company_id, event_key) WHERE is_system.
 */
return new class extends Migration
{
    private const array RULES = ['purchase.goods_received' => '381', 'purchase.price_variance' => '621'];

    public function up(): void
    {
        foreach (self::RULES as $event => $code) {
            $description = __('accounting::messages.rule_default_description', ['code' => $code]);

            DB::statement(<<<'SQL'
                INSERT INTO account_determination_rules (id, company_id, event_key, priority, conditions, account_id, description, is_system, is_active, version, created_at, updated_at)
                SELECT uuidv7(), a.company_id, ?, 0, '{}'::jsonb, a.id, ?, true, true, 1, now(), now()
                FROM accounts a
                WHERE a.code = ? AND a.is_postable AND a.is_active
                  AND NOT EXISTS (SELECT 1 FROM account_determination_rules r WHERE r.company_id = a.company_id AND r.event_key = ? AND r.is_system)
                ON CONFLICT DO NOTHING
                SQL, [$event, is_string($description) ? $description : "TDHP {$code}", $code, $event]);
        }
    }

    public function down(): void
    {
        DB::table('account_determination_rules')->where('is_system', true)->whereIn('event_key', array_keys(self::RULES))->delete();
    }
};
