<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Reports\Services;

use App\Modules\Purchasing\Enums\InvoiceStatus;
use App\Modules\Purchasing\Enums\InvoiceType;
use App\Modules\Purchasing\Enums\ReturnStatus;
use App\Modules\Purchasing\Reports\Data\ReportFilters;
use App\Modules\Purchasing\Reports\Data\ReportTable;
use App\Modules\Purchasing\Reports\Support\Grouper;
use App\Modules\Purchasing\Reports\Support\Num;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Purchase price variance in the range, as booked to purchase.price_variance (company currency):
 * - invoice lines with a variance (net minus the receipt value they cleared): + on the invoice
 *   date, and again negated on the reversal date of a reversed invoice;
 * - debit note lines: the mirror (their variance credited back), likewise with reversals;
 * - shipped returns: the receipt-cost correction (stock cost of the goods sent back minus the
 *   receipt value they carried) on the return date.
 * variance_amount > 0 is unfavourable (paid more than received value). Per line: receipt_value
 * (accrual cleared or carried), document_value (invoice net in company currency, or the stock cost
 * of a return), and for invoice lines of an order the order and invoice net unit prices in their
 * currencies with the difference in percent (when both are in the same currency).
 * The total equals the movement of the price variance account from purchasing documents.
 * Groups: line (default), supplier, item; lines by date, groups by variance.
 */
final class PriceVarianceReport
{
    public const array GROUPS = ['line', 'supplier', 'item'];

    private const array MONEY = ['receipt_value', 'document_value', 'variance_amount', 'unfavourable_amount', 'favourable_amount'];

    public function __construct(private readonly ItemDirectory $items) {}

    /** @return list<string> */
    public static function columns(string $by): array
    {
        return match ($by) {
            'line' => ['date', 'source', 'event', 'document_id', 'number', 'supplier_invoice_no', 'party_id', 'party_name', 'line_no',
                'item_id', 'item_code', 'item_name', 'order_id', 'order_number', 'currency_code', 'quantity', 'order_unit_price',
                'invoice_unit_price', 'price_difference_percent', 'receipt_value', 'document_value', 'variance_amount'],
            'supplier' => ['party_id', 'party_code', 'party_name', 'line_count', ...self::MONEY],
            default => ['item_id', 'item_code', 'item_name', 'line_count', ...self::MONEY],
        };
    }

    public function build(ReportFilters $f, string $by): ReportTable
    {
        $lines = [];

        foreach ($this->items->stream($this->invoiceLines($f)->lazyById(1000, 'l.id', 'id'), $f->categoryId !== null) as $row) {
            if ($this->excluded($f, $row)) {
                continue;
            }

            $events = [];

            if ($row->document_date >= $f->dateFrom && $row->document_date <= $f->dateTo) {
                $events[] = [(string) $row->document_date, 1, 'booked'];
            }

            if ($row->status === InvoiceStatus::Reversed->value && $row->reversal_date !== null
                && $row->reversal_date >= $f->dateFrom && $row->reversal_date <= $f->dateTo) {
                $events[] = [(string) $row->reversal_date, -1, 'reversed'];
            }

            $debitNote = $row->invoice_type === InvoiceType::Return->value;
            $qty = Num::dec($row->quantity);
            $invoicePrice = Num::dec($row->net_amount)->dividedBy($qty, 6, RoundingMode::HalfUp);
            $orderPrice = $row->order_quantity === null ? null : Num::dec($row->order_net)->dividedBy(Num::dec($row->order_quantity), 6, RoundingMode::HalfUp);
            $difference = $orderPrice === null || $orderPrice->isZero() || $row->order_currency !== $row->currency_code
                ? null : Num::percent($invoicePrice->minus($orderPrice), $orderPrice);

            foreach ($events as [$date, $sign, $event]) {
                $side = $debitNote ? -$sign : $sign;
                $lines[] = [
                    'date' => $date, 'source' => $debitNote ? 'debit_note' : 'invoice', 'event' => $event, 'document_id' => (string) $row->document_id,
                    'number' => $row->number, 'supplier_invoice_no' => $row->supplier_invoice_no, 'party_id' => (string) $row->party_id,
                    'party_code' => null, 'party_name' => (string) $row->party_name, 'line_no' => (int) $row->line_no, 'item_id' => (string) $row->item_id,
                    'item_code' => null, 'item_name' => null, 'order_id' => $row->order_id, 'order_number' => $row->order_number,
                    'currency_code' => (string) $row->currency_code, 'quantity' => Num::qty($qty),
                    'order_unit_price' => $orderPrice === null ? null : Num::qty($orderPrice), 'invoice_unit_price' => Num::qty($invoicePrice),
                    'price_difference_percent' => $difference,
                    ...self::amounts(Num::dec($row->grni_amount), Num::dec($row->net_local), Num::dec($row->variance_amount), $side),
                ];
            }
        }

        foreach ($this->items->stream($this->returnLines($f)->lazyById(1000, 'l.id', 'id'), $f->categoryId !== null) as $row) {
            if ($this->excluded($f, $row)) {
                continue;
            }

            $receiptValue = Num::dec($row->receipt_cost);
            $stockCost = Num::dec($row->cost_total);
            $lines[] = [
                'date' => (string) $row->document_date, 'source' => 'return', 'event' => 'shipped', 'document_id' => (string) $row->document_id,
                'number' => $row->number, 'supplier_invoice_no' => null, 'party_id' => (string) $row->party_id, 'party_code' => null,
                'party_name' => (string) $row->party_name, 'line_no' => (int) $row->line_no, 'item_id' => (string) $row->item_id,
                'item_code' => null, 'item_name' => null, 'order_id' => null, 'order_number' => null, 'currency_code' => (string) $row->currency_code,
                'quantity' => Num::qty(Num::dec($row->quantity)), 'order_unit_price' => null, 'invoice_unit_price' => null, 'price_difference_percent' => null,
                ...self::amounts($receiptValue, $stockCost, $stockCost->minus($receiptValue), 1),
            ];
        }

        usort($lines, static fn (array $a, array $b): int => [$a['date'], (string) $a['number'], $a['line_no'], $a['event']] <=> [$b['date'], (string) $b['number'], $b['line_no'], $b['event']]);
        $totals = array_fill_keys(self::MONEY, BigDecimal::zero());

        foreach ($lines as $line) {
            foreach (self::MONEY as $column) {
                $totals[$column] = $totals[$column]->plus(Num::dec($line[$column]));
            }
        }

        $columns = self::columns($by);
        $rows = match ($by) {
            'line' => array_map(static fn (array $l): array => array_intersect_key($l, array_flip($columns)), $lines),
            'supplier' => PurchaseGroupReport::sortBy(Grouper::group($lines, $columns, ['party_id'], self::MONEY), 'variance_amount'),
            default => PurchaseGroupReport::sortBy(Grouper::group($lines, $columns, ['item_id'], self::MONEY), 'variance_amount'),
        };

        return new ReportTable($rows, $columns, [
            'group_by' => $by,
            'totals' => ['line_count' => count($lines), ...array_map(Num::money(...), $totals)],
        ]);
    }

    /**
     * Signed amounts of one line: what moves the variance account and on which side.
     *
     * @return array<string, string>
     */
    private static function amounts(BigDecimal $receiptValue, BigDecimal $documentValue, BigDecimal $variance, int $side): array
    {
        $signed = $variance->multipliedBy($side);

        return [
            'receipt_value' => Num::money($receiptValue->multipliedBy($side)),
            'document_value' => Num::money($documentValue->multipliedBy($side)),
            'variance_amount' => Num::money($signed),
            'unfavourable_amount' => Num::money($signed->isPositive() ? $signed : BigDecimal::zero()),
            'favourable_amount' => Num::money($signed->isNegative() ? $signed : BigDecimal::zero()),
        ];
    }

    private function excluded(ReportFilters $f, stdClass $row): bool
    {
        return $f->categoryId !== null && $this->items->categoryOf((string) $row->item_id) !== $f->categoryId;
    }

    private function invoiceLines(ReportFilters $f): Builder
    {
        $from = (string) $f->dateFrom;
        $to = (string) $f->dateTo;

        return DB::table('purchase_invoice_lines as l')->join('purchase_invoices as i', 'i.id', '=', 'l.document_id')
            ->leftJoin('purchase_order_lines as ol', fn (JoinClause $j) => $j->on('ol.id', '=', 'l.order_line_id')->where('ol.company_id', '=', $f->companyId))
            ->leftJoin('purchase_orders as o', fn (JoinClause $j) => $j->on('o.id', '=', 'ol.document_id')->where('o.company_id', '=', $f->companyId))
            ->where('i.company_id', $f->companyId)->where('l.company_id', $f->companyId)
            ->whereIn('i.status', [...InvoiceStatus::booked(), InvoiceStatus::Reversed->value])
            ->where('l.variance_amount', '<>', 0)
            ->where(fn (Builder $q) => $q->whereBetween('i.document_date', [$from, $to])
                ->orWhere(fn (Builder $r) => $r->where('i.status', InvoiceStatus::Reversed->value)->whereBetween('i.reversal_date', [$from, $to])))
            ->when($f->partyId !== null, fn (Builder $q) => $q->where('i.party_id', $f->partyId))
            ->when($f->currencyCode !== null, fn (Builder $q) => $q->where('i.currency_code', $f->currencyCode))
            ->when($f->itemId !== null, fn (Builder $q) => $q->where('l.item_id', $f->itemId))
            ->when($f->warehouseId !== null, fn (Builder $q) => $q->whereRaw('coalesce(l.warehouse_id, i.warehouse_id) = ?', [$f->warehouseId]))
            ->select(['l.id', 'l.document_id', 'l.line_no', 'l.item_id', 'l.quantity', 'l.net_amount', 'l.net_local', 'l.grni_amount', 'l.variance_amount',
                'i.number', 'i.supplier_invoice_no', 'i.status', 'i.invoice_type', 'i.document_date', 'i.reversal_date', 'i.party_id', 'i.party_name',
                'i.currency_code', 'o.id as order_id', 'o.number as order_number', 'o.currency_code as order_currency',
                'ol.quantity as order_quantity', 'ol.net_amount as order_net']);
    }

    private function returnLines(ReportFilters $f): Builder
    {
        return DB::table('purchase_return_lines as l')->join('purchase_returns as r', 'r.id', '=', 'l.document_id')
            ->where('r.company_id', $f->companyId)->where('l.company_id', $f->companyId)
            ->whereIn('r.status', [ReturnStatus::Shipped->value, ReturnStatus::Debited->value])
            ->whereNotNull('l.receipt_cost')->whereNotNull('l.cost_total')->whereColumn('l.receipt_cost', '<>', 'l.cost_total')
            ->whereBetween('r.document_date', [(string) $f->dateFrom, (string) $f->dateTo])
            ->when($f->partyId !== null, fn (Builder $q) => $q->where('r.party_id', $f->partyId))
            ->when($f->currencyCode !== null, fn (Builder $q) => $q->where('r.currency_code', $f->currencyCode))
            ->when($f->itemId !== null, fn (Builder $q) => $q->where('l.item_id', $f->itemId))
            ->when($f->warehouseId !== null, fn (Builder $q) => $q->where('r.warehouse_id', $f->warehouseId))
            ->select(['l.id', 'l.document_id', 'l.line_no', 'l.item_id', 'l.quantity', 'l.receipt_cost', 'l.cost_total',
                'r.number', 'r.document_date', 'r.party_id', 'r.party_name', 'r.currency_code']);
    }
}
