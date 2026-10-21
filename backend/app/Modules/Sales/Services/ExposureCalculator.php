<?php

declare(strict_types=1);

namespace App\Modules\Sales\Services;

use App\Core\Company\CompanyContext;
use App\Core\Money\RoundingPolicy;
use App\Modules\Parties\Contracts\PartyLookup;
use App\Modules\Reference\Contracts\ExchangeRateProvider;
use App\Modules\Reference\Exceptions\RateNotFound;
use App\Modules\Sales\Contracts\CustomerExposure;
use App\Modules\Sales\Data\ExposureData;
use App\Modules\Sales\Enums\InvoiceStatus;
use App\Modules\Sales\Enums\OrderStatus;
use App\Modules\Sales\Support\Messages;
use App\Modules\Sales\Support\SalesSettings;
use Brick\Math\BigDecimal;
use DateTimeImmutable;
use Illuminate\Support\Facades\DB;

/**
 * exposure = open invoice balances (credit notes net them) + confirmed (or pending approval), not
 * invoiced order value,
 * each valued at its document's rate in company currency, then converted to the risk currency at
 * today's rate. Remaining order value = line_total * (quantity - invoiced) / quantity.
 */
final class ExposureCalculator implements CustomerExposure
{
    public function __construct(
        private readonly CompanyContext $company,
        private readonly PartyLookup $parties,
        private readonly ExchangeRateProvider $rates,
        private readonly SalesSettings $settings,
    ) {}

    public function exposure(string $companyId, string $partyId): ExposureData
    {
        return $this->company->runAs($companyId, function () use ($companyId, $partyId): ExposureData {
            $party = $this->parties->find($partyId);
            [$invoices, $orders] = $this->localParts($companyId, $partyId);

            return $this->inRiskCurrency($partyId, $party?->riskLimit, $party?->riskCurrencyCode, $invoices, $orders);
        });
    }

    /**
     * Open invoices and open orders in company currency, scale 2; an order can be left out (the one being confirmed).
     *
     * @return array{0: BigDecimal, 1: BigDecimal}
     */
    public function localParts(string $companyId, string $partyId, ?string $excludeOrderId = null): array
    {
        $invoices = DB::table('sales_invoices')->where('company_id', $companyId)->where('party_id', $partyId)
            ->whereIn('status', InvoiceStatus::open())
            ->selectRaw("coalesce(sum(round(balance_due * fx_rate, 2) * CASE WHEN invoice_type = 'return' THEN -1 ELSE 1 END), 0) AS amount")
            ->value('amount');

        $orders = DB::table('sales_order_lines as l')->join('sales_orders as o', 'o.id', '=', 'l.document_id')
            ->where('o.company_id', $companyId)->where('o.party_id', $partyId)->whereIn('o.status', OrderStatus::exposureValues())
            ->when($excludeOrderId !== null, fn ($q) => $q->where('o.id', '<>', $excludeOrderId))
            ->selectRaw('coalesce(sum(round(l.line_total * greatest(l.quantity - l.invoiced_quantity, 0) / l.quantity * o.fx_rate, 2)), 0) AS amount')
            ->value('amount');

        return [RoundingPolicy::currency(is_numeric($invoices) ? (string) $invoices : '0'), RoundingPolicy::currency(is_numeric($orders) ? (string) $orders : '0')];
    }

    public function inRiskCurrency(string $partyId, ?string $limit, ?string $riskCurrency, BigDecimal $invoices, BigDecimal $orders): ExposureData
    {
        $base = $this->settings->baseCurrency();
        $currency = $riskCurrency ?? $base;
        $rate = $this->toRisk($base, $currency);
        $inv = RoundingPolicy::currency($invoices->multipliedBy($rate));
        $ord = RoundingPolicy::currency($orders->multipliedBy($rate));
        $total = $inv->plus($ord);
        $limitValue = $limit === null ? null : RoundingPolicy::currency($limit);

        return new ExposureData(
            $partyId,
            $limitValue === null ? null : (string) $limitValue,
            $currency,
            (string) $inv,
            (string) $ord,
            (string) $total,
            $limitValue === null ? null : (string) $limitValue->minus($total),
        );
    }

    /** Rate from company currency to the risk currency (1 when they are the same). */
    public function toRisk(string $base, string $currency): BigDecimal
    {
        if ($currency === $base) {
            return BigDecimal::one();
        }

        try {
            return BigDecimal::of($this->rates->rate($base, $currency, new DateTimeImmutable(now()->toDateString())));
        } catch (RateNotFound) {
            Messages::fail('party_id', 'fx_rate_missing', ['currency' => $currency]);
        }
    }
}
