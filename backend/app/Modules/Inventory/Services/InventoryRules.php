<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Services;

use App\Core\Company\CompanyContext;
use App\Modules\Accounting\Contracts\AccountLookup;
use App\Modules\Inventory\Support\Messages;
use App\Modules\Inventory\Support\Stock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Default account determination rules of the inventory events (TDHP codes). inventory.stock (153)
 * and inventory.cogs (621) are seeded by Accounting. Accounting exposes no rule-writing contract,
 * so the system rules are inserted here by table and column name; the partial unique index
 * (company_id, event_key) WHERE is_system makes the seeding idempotent.
 */
final class InventoryRules
{
    /**
     * 197/397: count shortages and surpluses wait in Sayım ve Tesellüm Noksanları / Fazlaları until
     * resolved; 689 Diğer Olağandışı Gider ve Zararlar for scrap; opening stock is booked against
     * 500 Sermaye unless the opening journal entry already carries it (change the rule then).
     */
    public const array DEFAULTS = [
        'inventory.adjustment_gain' => '397',
        'inventory.adjustment_loss' => '197',
        'inventory.scrap' => '689',
        'inventory.opening_offset' => '500',
    ];

    public function __construct(
        private readonly CompanyContext $company,
        private readonly AccountLookup $accounts,
    ) {}

    /**
     * Creates the missing default rules whose account exists and is postable. Idempotent.
     *
     * @return int rules created
     */
    public function ensureDefaults(string $companyId): int
    {
        return $this->company->runAs($companyId, fn (): int => Stock::transaction(function () use ($companyId): int {
            $created = 0;

            foreach (self::DEFAULTS as $event => $code) {
                $account = $this->accounts->findByCode($code);

                if ($account === null || ! $account->isPostable || ! $account->isActive) {
                    continue;
                }

                $created += DB::table('account_determination_rules')->insertOrIgnore([
                    'id' => (string) Str::uuid7(),
                    'company_id' => $companyId,
                    'event_key' => $event,
                    'priority' => 0,
                    'conditions' => '{}',
                    'account_id' => $account->id,
                    'description' => Messages::get('rule_default_description', ['code' => $code]),
                    'is_system' => true,
                    'is_active' => true,
                    'version' => 1,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }

            return $created;
        }));
    }
}
