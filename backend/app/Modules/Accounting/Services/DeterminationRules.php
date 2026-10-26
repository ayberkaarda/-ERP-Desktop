<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Services;

use App\Modules\Accounting\Enums\ExpenseScheme;
use App\Modules\Accounting\Models\Account;
use App\Modules\Accounting\Models\AccountDeterminationRule;
use App\Modules\Accounting\Support\Ledger;
use App\Modules\Accounting\Support\Messages;
use Illuminate\Support\Str;

/**
 * Rule maintenance and the seeded per-company defaults (TDHP codes).
 */
final class DeterminationRules
{
    /**
     * Event => default TDHP account code; the 7/A and 7/B expense layouts differ for purchases.
     */
    public const array DEFAULTS = [
        'sales.receivable' => '120',
        'sales.revenue.goods' => '600',
        'sales.revenue.services' => '600',
        'sales.vat_output' => '391',
        'sales.returns' => '610',
        'purchase.payable' => '320',
        'purchase.expense' => ['7A' => '770', '7B' => '793'],
        'purchase.vat_input' => '191',
        'purchase.vat_withholding' => '360',
        // Goods received not invoiced: no party flag, the stock posting books it without a party.
        'purchase.goods_received' => '381',
        'purchase.price_variance' => '621',
        'inventory.stock' => '153',
        'inventory.cogs' => '621',
        'treasury.cash' => '100',
        'treasury.bank' => '102',
        'treasury.cheque_portfolio' => '101',
        'treasury.cheque_payable' => '103',
        'treasury.note_portfolio' => '121',
        'treasury.note_payable' => '321',
        'treasury.collection' => '108',
        'fx.gain' => '646',
        'fx.loss' => '656',
    ];

    /**
     * @param  array<string, mixed>  $data
     */
    public function create(array $data): AccountDeterminationRule
    {
        return Ledger::transaction(function () use ($data): AccountDeterminationRule {
            $rule = new AccountDeterminationRule;
            $this->fill($rule, $data);
            $rule->save();

            return $rule->load('account');
        });
    }

    /**
     * System rules keep their event key; everything else may change.
     *
     * @param  array<string, mixed>  $data
     */
    public function update(AccountDeterminationRule $rule, array $data, int $version): AccountDeterminationRule
    {
        return Ledger::transaction(function () use ($rule, $data, $version): AccountDeterminationRule {
            $locked = AccountDeterminationRule::query()->whereKey($rule->id)->lockForUpdate()->firstOrFail();
            $locked->assertVersion($version);

            if ($locked->is_system && isset($data['event_key']) && $data['event_key'] !== $locked->event_key) {
                Messages::fail('event_key', 'rule_system_event');
            }

            $this->fill($locked, $data);
            $locked->save();

            return $locked->load('account');
        });
    }

    public function delete(AccountDeterminationRule $rule, ?int $version): void
    {
        Ledger::transaction(function () use ($rule, $version): void {
            $locked = AccountDeterminationRule::query()->whereKey($rule->id)->lockForUpdate()->firstOrFail();

            if ($version !== null) {
                $locked->assertVersion($version);
            }

            if ($locked->is_system) {
                Messages::fail('rule', 'rule_system_delete');
            }

            $locked->delete();
        });
    }

    /**
     * Creates the default rule of every event whose account exists in the active company. Idempotent.
     *
     * @return int rules created
     */
    public function ensureDefaults(ExpenseScheme $scheme): int
    {
        return Ledger::transaction(function () use ($scheme): int {
            Ledger::lock('determination');
            $existing = AccountDeterminationRule::query()->where('is_system', true)->pluck('event_key')->all();
            $codes = [];

            foreach (self::DEFAULTS as $event => $code) {
                if (! in_array($event, $existing, true)) {
                    $codes[$event] = is_array($code) ? $code[$scheme->value] : $code;
                }
            }

            $accounts = Account::query()->whereIn('code', array_values($codes))->where('is_postable', true)->get()->keyBy('code');
            $created = 0;

            foreach ($codes as $event => $code) {
                $account = $accounts->get($code);

                if ($account === null) {
                    continue;
                }

                $rule = new AccountDeterminationRule(['event_key' => $event, 'priority' => 0, 'conditions' => [], 'account_id' => $account->id]);
                $rule->is_system = true;
                $rule->description = Messages::get('rule_default_description', ['code' => $code]);
                $rule->save();
                $created++;
            }

            return $created;
        });
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function fill(AccountDeterminationRule $rule, array $data): void
    {
        if (array_key_exists('account_id', $data)) {
            $account = is_string($data['account_id']) && Str::isUuid($data['account_id']) ? Account::query()->find($data['account_id']) : null;

            if ($account === null || ! $account->is_postable) {
                Messages::fail('account_id', $account === null ? 'account_missing' : 'account_not_postable', ['code' => $account->code ?? '']);
            }
        }

        if (array_key_exists('conditions', $data) && is_array($data['conditions'])) {
            $unknown = array_diff(array_keys($data['conditions']), RuleDeterminer::CONDITION_KEYS);

            if ($unknown !== []) {
                Messages::fail('conditions', 'rule_condition_unknown', ['keys' => implode(', ', $unknown)]);
            }
        }

        $rule->fill(array_intersect_key($data, array_flip(['event_key', 'priority', 'conditions', 'account_id', 'side', 'description', 'is_active'])));
    }
}
