<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Reports\Services;

use App\Core\Money\RoundingPolicy;
use App\Modules\Purchasing\Enums\InvoiceStatus;
use App\Modules\Purchasing\Enums\InvoiceType;
use App\Modules\Purchasing\Enums\ReceiptStatus;
use App\Modules\Purchasing\Enums\ReturnStatus;
use App\Modules\Purchasing\Reports\Data\ReportFilters;
use App\Modules\Purchasing\Reports\Data\ReportTable;
use App\Modules\Purchasing\Reports\Support\Num;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Supplier performance over the range for every supplier with purchasing activity in it (or with
 * overdue payables), with the same definitions and scales as the SupplierPerformance contract, in a
 * fixed number of grouped queries:
 * - orders: orders approved or later (not cancelled) dated in the range;
 * - on_time_rate (0..1, scale 4): posted receipt lines of order lines in the range received on or
 *   before the expected date (line, else order);
 * - fill_rate: received (capped at ordered) over ordered quantity of the stock lines of those orders;
 * - avg_lead_days (scale 2): first posted receipt date minus order date, orders dated in the range;
 * - price_variance_total (scale 2): variance of booked supplier invoices dated in the range;
 * - return_rate: base quantity shipped back over base quantity received in the range;
 * - overdue_payable (scale 2, company currency): open invoices due before today.
 * Only the supplier filter applies. Most orders first.
 */
final class SupplierPerformanceReport
{
    private const array ORDERED = ['approved', 'sent', 'partially_received', 'received', 'partially_invoiced', 'invoiced', 'closed'];

    public const array COLUMNS = ['party_id', 'party_code', 'party_name', 'orders', 'receipt_lines', 'on_time_lines', 'on_time_rate',
        'ordered_quantity', 'received_on_orders', 'fill_rate', 'avg_lead_days', 'price_variance_total', 'received_quantity',
        'returned_quantity', 'return_rate', 'overdue_payable'];

    public function __construct(private readonly ItemDirectory $items) {}

    public function build(ReportFilters $f, string $today): ReportTable
    {
        $c = $f->companyId;
        $range = [(string) $f->dateFrom, (string) $f->dateTo];
        $orders = $this->scoped(DB::table('purchase_orders as o')->where('o.company_id', $c)->whereIn('o.status', self::ORDERED)
            ->whereBetween('o.document_date', $range), 'o', $f);
        $figures = [];
        $put = static function (iterable $rows, array $fields) use (&$figures): void {
            foreach ($rows as $row) {
                foreach ($fields as $field) {
                    $figures[(string) $row->party_id][$field] = $row->{$field};
                }
            }
        };

        $put((clone $orders)->groupBy('o.party_id')->selectRaw('o.party_id, count(*) AS orders')->get(), ['orders']);
        $put(DB::table('purchase_order_lines as l')->joinSub((clone $orders)->select('o.id', 'o.party_id'), 'oo', 'oo.id', '=', 'l.document_id')
            ->where('l.company_id', $c)->where('l.item_type', 'stock')->groupBy('oo.party_id')
            ->selectRaw('oo.party_id, coalesce(sum(l.quantity), 0) AS ordered, coalesce(sum(least(l.received_quantity, l.quantity)), 0) AS received_on')
            ->get(), ['ordered', 'received_on']);
        $put($this->scoped(DB::table('purchase_receipt_lines as rl')->join('purchase_receipts as r', 'r.id', '=', 'rl.document_id')
            ->join('purchase_order_lines as ol', 'ol.id', '=', 'rl.order_line_id')->join('purchase_orders as o', 'o.id', '=', 'ol.document_id')
            ->where('r.company_id', $c)->where('rl.company_id', $c)->where('ol.company_id', $c)->where('o.company_id', $c)
            ->where('r.status', ReceiptStatus::Posted->value)->whereBetween('r.document_date', $range), 'r', $f)
            ->groupBy('r.party_id')
            ->selectRaw('r.party_id, count(*) AS lines, count(*) FILTER (WHERE r.document_date <= coalesce(ol.expected_date, o.expected_date, r.document_date)) AS on_time')
            ->get(), ['lines', 'on_time']);
        $put($this->scoped(DB::table('purchase_orders as o')->joinSub(
            DB::table('purchase_receipts')->where('company_id', $c)->where('status', ReceiptStatus::Posted->value)->whereNotNull('order_id')
                ->groupBy('order_id')->selectRaw('order_id, min(document_date) AS first_receipt'),
            'f', 'f.order_id', '=', 'o.id',
        )->where('o.company_id', $c)->whereBetween('o.document_date', $range), 'o', $f)
            ->groupBy('o.party_id')->selectRaw('o.party_id, avg(f.first_receipt - o.document_date) AS lead')->get(), ['lead']);
        $put($this->scoped(DB::table('purchase_invoice_lines as l')->join('purchase_invoices as i', 'i.id', '=', 'l.document_id')
            ->where('i.company_id', $c)->where('l.company_id', $c)->where('i.invoice_type', InvoiceType::Purchase->value)
            ->whereIn('i.status', InvoiceStatus::booked())->whereBetween('i.document_date', $range), 'i', $f)
            ->groupBy('i.party_id')->selectRaw('i.party_id, coalesce(sum(l.variance_amount), 0) AS variance')->get(), ['variance']);
        $put($this->scoped(DB::table('purchase_receipt_lines as l')->join('purchase_receipts as r', 'r.id', '=', 'l.document_id')
            ->where('r.company_id', $c)->where('l.company_id', $c)->where('r.status', ReceiptStatus::Posted->value)
            ->whereBetween('r.document_date', $range), 'r', $f)
            ->groupBy('r.party_id')->selectRaw('r.party_id, coalesce(sum(l.base_quantity), 0) AS received_qty')->get(), ['received_qty']);
        $put($this->scoped(DB::table('purchase_return_lines as l')->join('purchase_returns as r', 'r.id', '=', 'l.document_id')
            ->where('r.company_id', $c)->where('l.company_id', $c)->whereIn('r.status', [ReturnStatus::Shipped->value, ReturnStatus::Debited->value])
            ->whereBetween('r.document_date', $range), 'r', $f)
            ->groupBy('r.party_id')->selectRaw('r.party_id, coalesce(sum(l.base_quantity), 0) AS returned_qty')->get(), ['returned_qty']);
        $put($this->scoped(DB::table('purchase_invoices as i')->where('i.company_id', $c)->whereIn('i.status', InvoiceStatus::open())
            ->where('i.invoice_type', InvoiceType::Purchase->value)->where('i.due_date', '<', $today), 'i', $f)
            ->groupBy('i.party_id')->selectRaw('i.party_id, coalesce(sum(round(i.balance_due * i.fx_rate, 2)), 0) AS overdue')->get(), ['overdue']);

        $parties = $this->items->parties(array_map('strval', array_keys($figures)));
        $rows = [];

        foreach ($figures as $partyId => $x) {
            $ordered = Num::dec($x['ordered'] ?? '0');
            $lines = (int) ($x['lines'] ?? 0);
            $received = Num::dec($x['received_qty'] ?? '0');
            $partyId = (string) $partyId;
            $rows[] = [
                'party_id' => $partyId, 'party_code' => $parties[$partyId]['code'] ?? null, 'party_name' => $parties[$partyId]['name'] ?? null,
                'orders' => (int) ($x['orders'] ?? 0), 'receipt_lines' => $lines, 'on_time_lines' => (int) ($x['on_time'] ?? 0),
                'on_time_rate' => $lines === 0 ? null : self::ratio(BigDecimal::of((int) ($x['on_time'] ?? 0)), BigDecimal::of($lines)),
                'ordered_quantity' => Num::qty($ordered), 'received_on_orders' => Num::qty(Num::dec($x['received_on'] ?? '0')),
                'fill_rate' => $ordered->isZero() ? null : self::ratio(Num::dec($x['received_on'] ?? '0'), $ordered),
                'avg_lead_days' => is_numeric($x['lead'] ?? null) ? (string) BigDecimal::of((string) $x['lead'])->toScale(2, RoundingMode::HalfUp) : null,
                'price_variance_total' => (string) Num::dec($x['variance'] ?? '0')->toScale(2, RoundingMode::HalfUp),
                'received_quantity' => Num::qty($received), 'returned_quantity' => Num::qty(Num::dec($x['returned_qty'] ?? '0')),
                'return_rate' => $received->isZero() ? null : self::ratio(Num::dec($x['returned_qty'] ?? '0'), $received),
                'overdue_payable' => (string) RoundingPolicy::currency(Num::dec($x['overdue'] ?? '0')),
            ];
        }

        usort($rows, static fn (array $a, array $b): int => [$b['orders'], (string) $a['party_name'], $a['party_id']] <=> [$a['orders'], (string) $b['party_name'], $b['party_id']]);

        return new ReportTable($rows, self::COLUMNS, ['today' => $today, 'totals' => ['supplier_count' => count($rows)]]);
    }

    private function scoped(Builder $query, string $alias, ReportFilters $f): Builder
    {
        return $query->when($f->partyId !== null, fn (Builder $q) => $q->where("{$alias}.party_id", $f->partyId));
    }

    private static function ratio(BigDecimal $part, BigDecimal $whole): string
    {
        return (string) $part->dividedBy($whole, 4, RoundingMode::HalfUp);
    }
}
