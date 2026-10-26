<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Data;

/**
 * Supplier performance over a period (supplier risk score input). Rates are fractions 0..1 as
 * decimal strings (scale 4, null without data); amounts in company currency (scale 2).
 *   orders                 approved (or later) orders dated in the period
 *   on_time_rate           receipt lines on or before the expected date of their order (line); receipts
 *                          count on their date and, once cancelled, negatively on their reversal date
 *   fill_rate              received / ordered quantity of those orders
 *   avg_lead_days          days from order date to first posted receipt, averaged over received orders
 *   price_variance_total   price variance moved in the period: invoice line variances on the invoice
 *                          date (reversals negated on their reversal date, debit notes negative) plus
 *                          return cost corrections on the return date (as the price-variance report)
 *   return_rate            returned (shipped) / received quantity in the period (receipts as above)
 *   overdue_payable        open payables due before today
 */
final readonly class SupplierPerformanceData
{
    public function __construct(
        public string $partyId,
        public string $from,
        public string $to,
        public int $orders,
        public ?string $onTimeRate,
        public ?string $fillRate,
        public ?string $avgLeadDays,
        public string $priceVarianceTotal,
        public ?string $returnRate,
        public string $overduePayable,
    ) {}

    /** @return array<string, string|int|null> */
    public function toArray(): array
    {
        return [
            'party_id' => $this->partyId, 'from' => $this->from, 'to' => $this->to, 'orders' => $this->orders,
            'on_time_rate' => $this->onTimeRate, 'fill_rate' => $this->fillRate, 'avg_lead_days' => $this->avgLeadDays,
            'price_variance_total' => $this->priceVarianceTotal, 'return_rate' => $this->returnRate, 'overdue_payable' => $this->overduePayable,
        ];
    }
}
