<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Reports\Services;

use App\Modules\Purchasing\Enums\InvoiceStatus;
use App\Modules\Purchasing\Enums\InvoiceType;
use App\Modules\Purchasing\Enums\ReturnStatus;
use App\Modules\Purchasing\Reports\Data\ReportFilters;
use App\Modules\Purchasing\Reports\Data\ReportTable;
use App\Modules\Purchasing\Reports\Support\Num;
use App\Modules\Purchasing\Reports\Support\ReturnWarehouse;
use App\Modules\Purchasing\Reports\Support\Sql;
use App\Modules\Purchasing\Reports\Support\Window;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Facades\DB;

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
 * The total equals the movement of the price variance account from purchasing documents, and the
 * per-supplier totals equal SupplierMovements::varianceByParty (supplier performance).
 * Groups: line (default), supplier, item; lines by date, groups by variance. Computed in SQL: only
 * the requested page of rows (or groups) is read.
 */
final class PriceVarianceReport
{
    public const array GROUPS = ['line', 'supplier', 'item'];

    private const array MONEY = ['receipt_value', 'document_value', 'variance_amount', 'unfavourable_amount', 'favourable_amount'];

    private const array QUANTITIES = ['quantity', 'order_unit_price', 'invoice_unit_price'];

    private const array INTEGERS = ['line_no', 'line_count'];

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

    public function build(ReportFilters $f, string $by, Window $window): ReportTable
    {
        $category = $f->categoryId === null ? null : $this->items->inCategory(DB::query()->fromSub(
            DB::table('purchase_invoice_lines')->where('company_id', $f->companyId)->select('item_id')
                ->union(DB::table('purchase_return_lines')->where('company_id', $f->companyId)->select('item_id')), 'u',
        )->select('item_id'), $f->categoryId);
        $events = $this->invoiceEvents($f, 'booked', $category)
            ->unionAll($this->invoiceEvents($f, 'reversed', $category))
            ->unionAll($this->returnEvents($f, $category));
        $lines = DB::query()->fromSub($events, 't');
        $sums = 'coalesce(sum(t.receipt_value), 0) AS receipt_value, coalesce(sum(t.document_value), 0) AS document_value,
            coalesce(sum(t.variance_amount), 0) AS variance_amount, coalesce(sum(t.variance_amount) FILTER (WHERE t.variance_amount > 0), 0) AS unfavourable_amount,
            coalesce(sum(t.variance_amount) FILTER (WHERE t.variance_amount < 0), 0) AS favourable_amount';
        $totals = (clone $lines)->selectRaw("count(*) AS line_count, {$sums}")->first();
        $columns = self::columns($by);

        if ($by === 'line') {
            $ordered = $lines->select('t.*')->orderBy('t.date')->orderBy('t.number')->orderBy('t.line_no')->orderBy('t.event')->orderBy('t.line_id');
            $total = (int) ($totals->line_count ?? 0);
        } else {
            $key = $by === 'supplier' ? 't.party_id' : 't.item_id';
            $groups = $lines->groupBy($key)->selectRaw("{$key} AS group_key, {$key}, count(*) AS line_count, {$sums}"
                .($by === 'supplier' ? ', (array_agg(t.party_name ORDER BY t.date DESC, t.number DESC))[1] AS party_name' : ''));
            $total = Sql::count($groups);
            $ordered = DB::query()->fromSub($groups, 'g')->orderByDesc('g.variance_amount')->orderBy('g.group_key');
        }

        return new ReportTable(Sql::window($ordered, $window, $total, $columns, self::MONEY, self::QUANTITIES, self::INTEGERS), $columns, [
            'group_by' => $by,
            'totals' => [
                'line_count' => (int) ($totals->line_count ?? 0),
                ...array_combine(self::MONEY, array_map(static fn (string $c): string => Num::money(Num::dec($totals->{$c} ?? '0')), self::MONEY)),
            ],
        ], $total);
    }

    /**
     * Invoice and debit note lines with a variance, on their booking date or (negated) on their reversal date.
     */
    private function invoiceEvents(ReportFilters $f, string $event, ?string $category): Builder
    {
        $range = [(string) $f->dateFrom, (string) $f->dateTo];
        $reversal = $event === 'reversed';
        // Side on the variance account: invoices +, debit notes -, reversals negate.
        $side = '(CASE WHEN i.invoice_type = ? THEN -1 ELSE 1 END) * '.($reversal ? '-1' : '1');
        $sb = [InvoiceType::Return->value];
        $orderPrice = 'round(ol.net_amount / ol.quantity, 6)';
        $invoicePrice = 'round(l.net_amount / l.quantity, 6)';

        return $this->scoped(DB::table('purchase_invoice_lines as l')->join('purchase_invoices as i', 'i.id', '=', 'l.document_id')
            ->leftJoin('purchase_order_lines as ol', fn (JoinClause $j) => $j->on('ol.id', '=', 'l.order_line_id')->where('ol.company_id', '=', $f->companyId))
            ->leftJoin('purchase_orders as o', fn (JoinClause $j) => $j->on('o.id', '=', 'ol.document_id')->where('o.company_id', '=', $f->companyId))
            ->where('i.company_id', $f->companyId)->where('l.company_id', $f->companyId)->where('l.variance_amount', '<>', 0)
            ->when($reversal, fn (Builder $q) => $q->where('i.status', InvoiceStatus::Reversed->value)->whereBetween('i.reversal_date', $range))
            ->when(! $reversal, fn (Builder $q) => $q->whereIn('i.status', [...InvoiceStatus::booked(), InvoiceStatus::Reversed->value])->whereBetween('i.document_date', $range))
            ->when($f->currencyCode !== null, fn (Builder $q) => $q->where('i.currency_code', $f->currencyCode))
            ->when($f->warehouseId !== null, fn (Builder $q) => $q->whereRaw('coalesce(l.warehouse_id, i.warehouse_id) = ?', [$f->warehouseId])), 'i', $f, $category)
            ->selectRaw(($reversal ? 'i.reversal_date' : 'i.document_date').' AS date')
            ->selectRaw("CASE WHEN i.invoice_type = ? THEN 'debit_note' ELSE 'invoice' END AS source, ?::text AS event", [InvoiceType::Return->value, $event])
            ->selectRaw('l.document_id, i.number, i.supplier_invoice_no, i.party_id, i.party_name, l.line_no, l.item_id, o.id AS order_id,
                o.number AS order_number, i.currency_code, l.quantity')
            ->selectRaw("CASE WHEN ol.id IS NULL THEN NULL ELSE {$orderPrice} END AS order_unit_price, {$invoicePrice} AS invoice_unit_price")
            ->selectRaw("CASE WHEN ol.id IS NULL OR o.currency_code <> i.currency_code OR {$orderPrice} = 0 THEN NULL
                ELSE round(({$invoicePrice} - {$orderPrice}) * 100 / {$orderPrice}, 2) END AS price_difference_percent")
            ->selectRaw("l.grni_amount * {$side} AS receipt_value, l.net_local * {$side} AS document_value, l.variance_amount * {$side} AS variance_amount", [...$sb, ...$sb, ...$sb])
            ->selectRaw('l.id AS line_id');
    }

    /** Receipt-cost corrections of shipped returns, on the return date. */
    private function returnEvents(ReportFilters $f, ?string $category): Builder
    {
        return $this->scoped(DB::table('purchase_return_lines as l')->join('purchase_returns as r', 'r.id', '=', 'l.document_id')
            ->where('r.company_id', $f->companyId)->where('l.company_id', $f->companyId)
            ->whereIn('r.status', [ReturnStatus::Shipped->value, ReturnStatus::Debited->value])
            ->whereNotNull('l.receipt_cost')->whereNotNull('l.cost_total')->whereColumn('l.receipt_cost', '<>', 'l.cost_total')
            ->whereBetween('r.document_date', [(string) $f->dateFrom, (string) $f->dateTo])
            ->when($f->currencyCode !== null, fn (Builder $q) => $q->where('r.currency_code', $f->currencyCode))
            ->when($f->warehouseId !== null, fn (Builder $q) => $q->whereRaw(ReturnWarehouse::expression().' = ?', [$f->warehouseId])), 'r', $f, $category)
            ->selectRaw("r.document_date AS date, 'return' AS source, 'shipped' AS event, l.document_id, r.number, NULL AS supplier_invoice_no,
                r.party_id, r.party_name, l.line_no, l.item_id, NULL::uuid AS order_id, NULL AS order_number, r.currency_code, l.quantity,
                NULL::numeric AS order_unit_price, NULL::numeric AS invoice_unit_price, NULL::numeric AS price_difference_percent,
                l.receipt_cost AS receipt_value, l.cost_total AS document_value, l.cost_total - l.receipt_cost AS variance_amount, l.id AS line_id");
    }

    private function scoped(Builder $query, string $header, ReportFilters $f, ?string $category): Builder
    {
        return $query->when($f->partyId !== null, fn (Builder $q) => $q->where("{$header}.party_id", $f->partyId))
            ->when($f->itemId !== null, fn (Builder $q) => $q->where('l.item_id', $f->itemId))
            ->when($category !== null, fn (Builder $q) => $q->whereRaw('l.item_id = ANY(?::uuid[])', [$category]));
    }
}
