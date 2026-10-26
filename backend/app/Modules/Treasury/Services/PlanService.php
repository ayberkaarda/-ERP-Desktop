<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Services;

use App\Modules\Parties\Contracts\PartyLookup;
use App\Modules\Reference\Contracts\CurrencyLookup;
use App\Modules\Treasury\Contracts\TreasuryPaymentLookup;
use App\Modules\Treasury\Enums\PlanStatus;
use App\Modules\Treasury\Models\TreasuryPaymentPlan;
use App\Modules\Treasury\Support\Treasury;
use Illuminate\Support\Facades\DB;

final class PlanService
{
    /** @param array<string,mixed> $input */
    public function save(?TreasuryPaymentPlan $plan, array $input, ?int $version): TreasuryPaymentPlan
    {
        return DB::transaction(function () use ($plan, $input, $version): TreasuryPaymentPlan {
            if ($plan !== null) {
                $plan = $this->lock($plan->id);
                $plan->assertVersion($version ?? 0);
                $this->scheduled($plan);
            } else {
                $plan = new TreasuryPaymentPlan;
            }
            $data = [...$plan->getAttributes(), ...$input];
            $party = app(PartyLookup::class)->find((string) $data['party_id']);
            if ($party === null || ! $party->isActive) {
                Treasury::fail('party_id', 'unknown');
            }
            if (! app(CurrencyLookup::class)->exists((string) $data['currency_code'])) {
                Treasury::fail('currency_code', 'currency_invalid');
            }
            if (isset($data['account_id'])) {
                $a = app(AccountService::class)->account((string) $data['account_id']);
                if ($a->getAttribute('currency_code') !== $data['currency_code']) {
                    Treasury::fail('account_id', 'currency_invalid');
                }
            }
            $plan->fill($input);
            if (! $plan->exists) {
                $plan->setAttribute('status', PlanStatus::Scheduled->value);
            }
            $plan->save();

            return $plan;
        });
    }

    public function fulfil(string $id, int $version, string $paymentId): TreasuryPaymentPlan
    {
        return DB::transaction(function () use ($id, $version, $paymentId): TreasuryPaymentPlan {
            $payment = app(TreasuryPaymentLookup::class)->findForUpdate($paymentId);
            $p = $this->lock($id);
            $p->assertVersion($version);
            $this->scheduled($p);
            if ($payment === null || $payment->partyId !== $p->getAttribute('party_id') || $payment->direction !== $p->getAttribute('direction') || $payment->currencyCode !== $p->getAttribute('currency_code') || ! Treasury::decimal($payment->amount)->isEqualTo((string) $p->getAttribute('amount')) || ($p->getAttribute('account_id') !== null && $payment->accountId !== $p->getAttribute('account_id'))) {
                Treasury::fail('payment_id', 'payment_invalid');
            }
            if (TreasuryPaymentPlan::query()->where('payment_id', $paymentId)->exists()) {
                Treasury::fail('payment_id', 'duplicate');
            }
            $p->fill(['status' => PlanStatus::Fulfilled->value, 'payment_id' => $paymentId]);
            $p->save();

            return $p;
        });
    }

    public function cancel(string $id, int $version): TreasuryPaymentPlan
    {
        return DB::transaction(function () use ($id, $version): TreasuryPaymentPlan {
            $p = $this->lock($id);
            $p->assertVersion($version);
            $this->scheduled($p);
            $p->setAttribute('status', PlanStatus::Cancelled->value);
            $p->save();

            return $p;
        });
    }

    public function delete(string $id, int $version): void
    {
        DB::transaction(function () use ($id, $version): void {
            $p = $this->lock($id);
            $p->assertVersion($version);
            $this->scheduled($p);
            $p->delete();
        });
    }

    private function scheduled(TreasuryPaymentPlan $p): void
    {
        if ($p->getAttribute('status') !== PlanStatus::Scheduled->value) {
            Treasury::fail('status', 'transition');
        }
    }

    private function lock(string $id): TreasuryPaymentPlan
    {
        return TreasuryPaymentPlan::query()->whereKey($id)->lockForUpdate()->firstOrFail();
    }
}
