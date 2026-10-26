<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Services;

use App\Modules\Purchasing\Enums\MatchStatus;
use App\Modules\Purchasing\Models\PurchaseInvoice;
use App\Modules\Purchasing\Models\PurchaseInvoiceLine;
use App\Modules\Purchasing\Models\PurchaseOrderLine;
use App\Modules\Purchasing\Support\Purchasing;
use App\Modules\Purchasing\Support\PurchasingSettings;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use Illuminate\Support\Collection;

/**
 * Three-way match of a supplier invoice: each line against its order line (price) and against what
 * was ordered or received (quantity).
 *   price: |invoice net unit price - order net unit price| / order net unit price must stay within
 *          purchasing.match_price_tolerance_percent;
 *   qty:   all invoices of the order line (this one included) must stay within the received
 *          quantity (lines invoiced from receipts) or the ordered quantity (services, and goods
 *          received at booking) plus purchasing.match_qty_tolerance_percent.
 * Lines without an order are unmatched. The invoice carries the worst result of its lines.
 */
final class ThreeWayMatch
{
    public function __construct(
        private readonly Quantities $quantities,
        private readonly PurchasingSettings $settings,
    ) {}

    /**
     * @param  Collection<int, PurchaseInvoiceLine>  $lines
     * @return array{status: MatchStatus, lines: array<string, array{status: MatchStatus, details: array<string, mixed>}>}
     */
    public function evaluate(PurchaseInvoice $invoice, Collection $lines): array
    {
        $priceTolerance = $this->settings->priceTolerance();
        $qtyTolerance = $this->settings->qtyTolerance();
        $orderLines = PurchaseOrderLine::query()->whereIn('id', $lines->pluck('order_line_id')->filter()->unique()->values()->all())->get()->keyBy('id');
        $thisInvoice = [];

        foreach ($lines as $line) {
            if ($line->order_line_id !== null) {
                $thisInvoice[$line->order_line_id] = ($thisInvoice[$line->order_line_id] ?? BigDecimal::zero())->plus($line->quantity);
            }
        }

        $out = [];
        $worst = MatchStatus::Matched;

        foreach ($lines as $line) {
            $orderLine = $line->order_line_id === null ? null : $orderLines->get($line->order_line_id);

            if (! $orderLine instanceof PurchaseOrderLine) {
                $out[$line->id] = ['status' => MatchStatus::Unmatched, 'details' => ['line_no' => $line->line_no, 'reason' => 'no_order']];
                $worst = MatchStatus::Unmatched->weight() > $worst->weight() ? MatchStatus::Unmatched : $worst;

                continue;
            }

            $orderPrice = $orderLine->netUnitPrice();
            $invoicePrice = $line->netUnitPrice();
            $priceDiff = $orderPrice->isZero()
                ? ($invoicePrice->isZero() ? BigDecimal::zero() : BigDecimal::of(100))
                : $invoicePrice->minus($orderPrice)->abs()->multipliedBy(100)->dividedBy($orderPrice, 4, RoundingMode::HalfUp);
            $invoiced = $this->quantities->invoicedOnOrder($orderLine->id, $invoice->id)->plus($thisInvoice[$orderLine->id] ?? BigDecimal::zero());
            $reference = $orderLine->isStock() && $line->receipt_line_id !== null ? $orderLine->received_quantity : $orderLine->quantity;
            $allowed = $reference->multipliedBy(BigDecimal::of(100)->plus($qtyTolerance))->dividedBy(100, 6, RoundingMode::Down);
            $status = match (true) {
                $invoiced->isGreaterThan($allowed) => MatchStatus::QtyVariance,
                $priceDiff->isGreaterThan($priceTolerance) => MatchStatus::PriceVariance,
                default => MatchStatus::Matched,
            };
            $worst = $status->weight() > $worst->weight() ? $status : $worst;
            $out[$line->id] = ['status' => $status, 'details' => [
                'line_no' => $line->line_no,
                'order_line_id' => $orderLine->id,
                'ordered' => Purchasing::qty($orderLine->quantity),
                'received' => Purchasing::qty($orderLine->received_quantity),
                'invoiced' => Purchasing::qty($invoiced),
                'reference' => Purchasing::qty($reference),
                'order_price' => (string) $orderPrice,
                'invoice_price' => (string) $invoicePrice,
                'price_difference_percent' => (string) $priceDiff,
                'qty_tolerance_percent' => (string) $qtyTolerance,
                'price_tolerance_percent' => (string) $priceTolerance,
            ]];
        }

        return ['status' => $worst, 'lines' => $out];
    }

    /**
     * The match as an API breakdown.
     *
     * @param  array{status: MatchStatus, lines: array<string, array{status: MatchStatus, details: array<string, mixed>}>}  $result
     * @return array<string, mixed>
     */
    public static function breakdown(array $result, string $mode): array
    {
        $lines = [];

        foreach ($result['lines'] as $id => $line) {
            $lines[] = ['invoice_line_id' => $id, 'status' => $line['status']->value, ...$line['details']];
        }

        return ['mode' => $mode, 'status' => $result['status']->value, 'lines' => $lines];
    }
}
