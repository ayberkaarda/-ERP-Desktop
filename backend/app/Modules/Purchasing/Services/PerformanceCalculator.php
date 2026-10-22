<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Services;

use App\Core\Company\CompanyContext;
use App\Modules\Purchasing\Contracts\SupplierPerformance;
use App\Modules\Purchasing\Data\SupplierPerformanceData;
use App\Modules\Purchasing\Enums\InvoiceStatus;
use App\Modules\Purchasing\Support\Purchasing;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use DateTimeInterface;
use Illuminate\Support\Facades\DB;

/**
 * Supplier performance over [from, to] from the module's own documents (see SupplierPerformanceData).
 */
final class PerformanceCalculator implements SupplierPerformance
{
    private const array ORDERED = ['approved', 'sent', 'partially_received', 'received', 'partially_invoiced', 'invoiced', 'closed'];

    public function forParty(string $companyId, string $partyId, DateTimeInterface $from, DateTimeInterface $to): SupplierPerformanceData
    {
        return app(CompanyContext::class)->runAs($companyId, function () use ($companyId, $partyId, $from, $to): SupplierPerformanceData {
            $start = $from->format('Y-m-d');
            $end = $to->format('Y-m-d');
            $orders = DB::table('purchase_orders')->where('company_id', $companyId)->where('party_id', $partyId)
                ->whereIn('status', self::ORDERED)->whereBetween('document_date', [$start, $end]);
            $orderCount = (clone $orders)->count();
            $fill = DB::table('purchase_order_lines as l')->joinSub($orders->select('id', 'document_date', 'expected_date'), 'o', 'o.id', '=', 'l.document_id')
                ->where('l.item_type', 'stock')
                ->selectRaw('coalesce(sum(l.quantity), 0) AS ordered, coalesce(sum(least(l.received_quantity, l.quantity)), 0) AS received')->first();
            $receipts = DB::table('purchase_receipt_lines as rl')->join('purchase_receipts as r', 'r.id', '=', 'rl.document_id')
                ->join('purchase_order_lines as ol', 'ol.id', '=', 'rl.order_line_id')->join('purchase_orders as o', 'o.id', '=', 'ol.document_id')
                ->where('r.company_id', $companyId)->where('r.party_id', $partyId)->where('r.status', 'posted')
                ->whereBetween('r.document_date', [$start, $end])
                ->selectRaw('count(*) AS lines, count(*) FILTER (WHERE r.document_date <= coalesce(ol.expected_date, o.expected_date, r.document_date)) AS on_time')
                ->first();
            $lead = DB::table('purchase_orders as o')->joinSub(
                DB::table('purchase_receipts')->where('company_id', $companyId)->where('status', 'posted')->whereNotNull('order_id')
                    ->groupBy('order_id')->selectRaw('order_id, min(document_date) AS first_receipt'),
                'f', 'f.order_id', '=', 'o.id',
            )->where('o.company_id', $companyId)->where('o.party_id', $partyId)->whereBetween('o.document_date', [$start, $end])
                ->selectRaw('avg(f.first_receipt - o.document_date) AS days')->value('days');
            $variance = DB::table('purchase_invoice_lines as l')->join('purchase_invoices as i', 'i.id', '=', 'l.document_id')
                ->where('i.company_id', $companyId)->where('i.party_id', $partyId)->where('i.invoice_type', 'purchase')
                ->whereIn('i.status', InvoiceStatus::booked())->whereBetween('i.document_date', [$start, $end])
                ->selectRaw('coalesce(sum(l.variance_amount), 0) AS amount')->value('amount');
            $received = DB::table('purchase_receipt_lines as l')->join('purchase_receipts as r', 'r.id', '=', 'l.document_id')
                ->where('r.company_id', $companyId)->where('r.party_id', $partyId)->where('r.status', 'posted')
                ->whereBetween('r.document_date', [$start, $end])->selectRaw('coalesce(sum(l.base_quantity), 0) AS qty')->value('qty');
            $returned = DB::table('purchase_return_lines as l')->join('purchase_returns as r', 'r.id', '=', 'l.document_id')
                ->where('r.company_id', $companyId)->where('r.party_id', $partyId)->whereIn('r.status', ['shipped', 'debited'])
                ->whereBetween('r.document_date', [$start, $end])->selectRaw('coalesce(sum(l.base_quantity), 0) AS qty')->value('qty');
            [, , $overdue] = app(ExposureCalculator::class)->localParts($companyId, $partyId);

            $ordered = Purchasing::dec(is_numeric($fill?->ordered) ? (string) $fill->ordered : '0');
            $receivedOnOrders = Purchasing::dec(is_numeric($fill?->received) ? (string) $fill->received : '0');
            $receiptLines = (int) ($receipts->lines ?? 0);
            $receivedQty = Purchasing::dec(is_numeric($received) ? (string) $received : '0');

            return new SupplierPerformanceData(
                $partyId,
                $start,
                $end,
                $orderCount,
                $receiptLines === 0 ? null : self::ratio(BigDecimal::of((int) ($receipts->on_time ?? 0)), BigDecimal::of($receiptLines)),
                $ordered->isZero() ? null : self::ratio($receivedOnOrders, $ordered),
                is_numeric($lead) ? (string) BigDecimal::of((string) $lead)->toScale(2, RoundingMode::HalfUp) : null,
                (string) Purchasing::dec(is_numeric($variance) ? (string) $variance : '0')->toScale(2, RoundingMode::HalfUp),
                $receivedQty->isZero() ? null : self::ratio(Purchasing::dec(is_numeric($returned) ? (string) $returned : '0'), $receivedQty),
                (string) $overdue,
            );
        });
    }

    private static function ratio(BigDecimal $part, BigDecimal $whole): string
    {
        return (string) $part->dividedBy($whole, 4, RoundingMode::HalfUp);
    }
}
