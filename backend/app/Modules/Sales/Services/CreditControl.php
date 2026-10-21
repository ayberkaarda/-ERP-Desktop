<?php

declare(strict_types=1);

namespace App\Modules\Sales\Services;

use App\Core\Money\RoundingPolicy;
use App\Modules\Parties\Data\PartyData;
use App\Modules\Sales\Data\CreditCheck;
use App\Modules\Sales\Enums\CreditCheckMode;
use App\Modules\Sales\Exceptions\CreditLimitExceeded;
use App\Modules\Sales\Support\Messages;
use App\Modules\Sales\Support\Sales;
use App\Modules\Sales\Support\SalesSettings;
use Brick\Math\BigDecimal;

/**
 * Credit check at order confirmation and invoice issue. Runs inside the document transaction and
 * takes a per-party advisory lock first, so two documents of one customer are checked one after
 * the other (the second sees the first as exposure). Parties without a risk limit are unlimited.
 */
final class CreditControl
{
    public function __construct(
        private readonly ExposureCalculator $exposure,
        private readonly SalesSettings $settings,
    ) {}

    /**
     * @param  string  $documentLocal  this document's total in company currency
     * @param  string  $coveredLocal  part of the document already counted as open order value
     *
     * @throws CreditLimitExceeded in block mode without an authorized override
     */
    public function check(string $companyId, PartyData $party, string $documentLocal, ?string $excludeOrderId = null, string $coveredLocal = '0', ?string $overrideReason = null, bool $canOverride = false, bool $preview = false): ?CreditCheck
    {
        $mode = $this->settings->creditCheckMode();

        if ($mode === CreditCheckMode::Off) {
            return null;
        }

        if (! $preview) {
            Sales::lock($companyId, 'credit.'.$party->id);
        }
        [$invoices, $orders] = $this->exposure->localParts($companyId, $party->id, $excludeOrderId);
        $exposure = $this->exposure->inRiskCurrency($party->id, $party->riskLimit, $party->riskCurrencyCode, $invoices, $orders);
        $document = BigDecimal::of($this->documentAmount($exposure->currency, $documentLocal, $coveredLocal));
        $total = BigDecimal::of($exposure->total)->plus($document);

        if ($exposure->limit === null) {
            return new CreditCheck($mode->value, null, $exposure->currency, $exposure->total, (string) $document, (string) $total, null, false);
        }

        // A document that adds nothing (an invoice of already confirmed order value) never trips the limit again.
        $exceeded = $document->isPositive() && $total->isGreaterThan($exposure->limit);
        $reason = $overrideReason === null ? null : trim($overrideReason);
        $overridden = $exceeded && $canOverride && $reason !== null && $reason !== '';
        $check = new CreditCheck($mode->value, $exposure->limit, $exposure->currency, $exposure->total, (string) $document, (string) $total,
            (string) BigDecimal::of($exposure->limit)->minus($total), $exceeded, $overridden);

        if ($exceeded && $mode === CreditCheckMode::Block && ! $overridden && ! $preview) {
            throw new CreditLimitExceeded($check);
        }

        return $check;
    }

    /**
     * What a document adds to the exposure, in the risk currency at scale 2 (never negative): its
     * company currency total less the open order value it replaces.
     */
    public function documentAmount(string $riskCurrency, string $documentLocal, string $coveredLocal = '0'): string
    {
        $rate = $this->exposure->toRisk($this->settings->baseCurrency(), $riskCurrency);
        $document = RoundingPolicy::currency(BigDecimal::of($documentLocal)->minus($coveredLocal)->multipliedBy($rate));

        return (string) ($document->isNegative() ? BigDecimal::zero()->toScale(2) : $document);
    }

    /**
     * Response meta warning for a check that went over the limit (warn mode or override).
     *
     * @return array<string, mixed>|null
     */
    public static function warning(?CreditCheck $check): ?array
    {
        if ($check === null || ! $check->exceeded) {
            return null;
        }

        return [
            'code' => CreditLimitExceeded::CODE,
            'message' => Messages::get($check->overridden ? 'credit_limit_overridden' : 'credit_limit_exceeded', ['limit' => (string) $check->limit, 'currency' => $check->currency]),
            'details' => $check->toArray(),
        ];
    }
}
