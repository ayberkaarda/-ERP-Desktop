<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Reports\Services;

use App\Modules\Purchasing\Enums\InvoiceStatus;
use App\Modules\Purchasing\Enums\InvoiceType;
use App\Modules\Purchasing\Enums\ReceiptStatus;
use App\Modules\Purchasing\Enums\ReturnStatus;
use App\Modules\Purchasing\Reports\Data\ReportFilters;
use App\Modules\Purchasing\Reports\Data\ReportTable;
use App\Modules\Purchasing\Reports\Support\Grouper;
use App\Modules\Purchasing\Reports\Support\Num;
use Brick\Math\RoundingMode;
use DateTimeImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Facades\DB;

/**
 * Goods received not invoiced (GRNI) as of a date: the accrual (purchase.goods_received) per receipt
 * line, rebuilt from the document dates the ledger books on:
 * - received: receipt lines of receipts posted on or before as_of and not cancelled by then (a
 *   receipt whose stock reversal is dated after as_of still counts), at their recorded cost;
 * - invoiced: supplier invoice lines on the receipt line booked on or before as_of and not reversed
 *   by then (their grni_amount, what the booking cleared), less debit note lines on it likewise;
 * - returned: lines of returns shipped (document date on or before as_of) on the receipt line, at
 *   their receipt_cost (what the shipment moved on the accrual);
 * - in_draft_quantity: current draft/pending invoice lines on it (today, not as of).
 * uninvoiced = received - invoiced - returned, in quantity and in company currency value; a return
 * shipped and not yet debited shows as a negative value until its debit note, and so does an
 * invoice dated before its receipt (the receipt counts from its own date). Lines with nothing open
 * are left out. The value total equals the credit balance of the accrual account on as_of.
 * The optional date range filters on the receipt date. Groups: line (default), receipt, supplier, item.
 */
final class ReceiptInvoiceReport
{
    public const array GROUPS = ['line', 'receipt', 'supplier', 'item'];

    private const array MONEY = ['received_value', 'invoiced_value', 'returned_value', 'uninvoiced_value'];

    public function __construct(private readonly ItemDirectory $items) {}

    /** @return list<string> */
    public static function columns(string $by): array
    {
        return match ($by) {
            'line' => ['receipt_id', 'receipt_number', 'document_date', 'days_open', 'order_id', 'order_number', 'party_id', 'party_name', 'line_no',
                'item_id', 'item_code', 'item_name', 'unit_id', 'warehouse_id', 'currency_code', 'received_quantity', 'invoiced_quantity',
                'returned_quantity', 'uninvoiced_quantity', 'in_draft_quantity', 'uninvoiced_base_quantity', ...self::MONEY],
            'receipt' => ['receipt_id', 'receipt_number', 'document_date', 'days_open', 'order_id', 'order_number', 'party_id', 'party_name',
                'currency_code', 'line_count', ...self::MONEY],
            'supplier' => ['party_id', 'party_code', 'party_name', 'receipt_count', 'line_count', ...self::MONEY],
            default => ['item_id', 'item_code', 'item_name', 'receipt_count', 'line_count', 'uninvoiced_base_quantity', ...self::MONEY],
        };
    }

    public function build(ReportFilters $f, string $by): ReportTable
    {
        $asOf = (string) $f->asOf;
        $lines = [];
        $totals = array_fill_keys(self::MONEY, Num::zero());
        $receipts = [];

        foreach ($this->items->stream($this->query($f, $asOf)->lazyById(1000, 'l.id', 'id'), $f->categoryId !== null) as $row) {
            if ($f->categoryId !== null && $this->items->categoryOf((string) $row->item_id) !== $f->categoryId) {
                continue;
            }

            $lineQty = Num::dec($row->quantity);
            $received = (int) $row->counted === 1;
            $qty = $received ? $lineQty : Num::zero();
            $invoicedQty = Num::dec($row->invoiced_qty);
            $returnedQty = Num::dec($row->returned_qty);
            $openQty = $qty->minus($invoicedQty)->minus($returnedQty);
            $values = [
                'received_value' => $received ? Num::dec($row->cost_total) : Num::zero(),
                'invoiced_value' => Num::dec($row->invoiced_value),
                'returned_value' => Num::dec($row->returned_value),
            ];
            $values['uninvoiced_value'] = $values['received_value']->minus($values['invoiced_value'])->minus($values['returned_value']);

            if ($openQty->isZero() && $values['uninvoiced_value']->isZero()) {
                continue;
            }

            $lines[] = [
                'receipt_id' => (string) $row->receipt_id, 'receipt_number' => $row->number, 'document_date' => (string) $row->document_date,
                'days_open' => $received ? (int) (new DateTimeImmutable((string) $row->document_date))->diff(new DateTimeImmutable($asOf))->days : 0,
                'order_id' => $row->order_id, 'order_number' => $row->order_number, 'party_id' => (string) $row->party_id, 'party_code' => null,
                'party_name' => (string) $row->party_name, 'line_no' => (int) $row->line_no, 'item_id' => (string) $row->item_id, 'item_code' => null,
                'item_name' => null, 'unit_id' => (string) $row->unit_id, 'warehouse_id' => is_string($row->warehouse_id) ? $row->warehouse_id : null,
                'currency_code' => (string) $row->currency_code, 'received_quantity' => Num::qty($qty), 'invoiced_quantity' => Num::qty($invoicedQty),
                'returned_quantity' => Num::qty($returnedQty), 'uninvoiced_quantity' => Num::qty($openQty), 'in_draft_quantity' => Num::qty(Num::dec($row->in_draft)),
                'uninvoiced_base_quantity' => Num::qty(Num::dec($row->base_quantity)->multipliedBy($openQty)->dividedBy($lineQty, 6, RoundingMode::HalfUp)),
                ...array_map(Num::money(...), $values),
            ];

            foreach ($values as $column => $value) {
                $totals[$column] = $totals[$column]->plus($value);
            }

            $receipts[(string) $row->receipt_id] = true;
        }

        usort($lines, static fn (array $a, array $b): int => [$a['document_date'], (string) $a['receipt_number'], $a['line_no']] <=> [$b['document_date'], (string) $b['receipt_number'], $b['line_no']]);
        $columns = self::columns($by);
        $rows = match ($by) {
            'line' => array_map(static fn (array $l): array => array_intersect_key($l, array_flip($columns)), $lines),
            'receipt' => Grouper::group($lines, $columns, ['receipt_id'], self::MONEY),
            'supplier' => Grouper::group($lines, $columns, ['party_id'], self::MONEY, [], ['receipt_count' => 'receipt_id']),
            default => Grouper::group($lines, $columns, ['item_id'], self::MONEY, ['uninvoiced_base_quantity'], ['receipt_count' => 'receipt_id']),
        };

        return new ReportTable($by === 'line' ? $rows : PurchaseGroupReport::sortBy($rows, 'uninvoiced_value'), $columns, [
            'as_of' => $asOf,
            'group_by' => $by,
            'totals' => ['receipt_count' => count($receipts), 'line_count' => count($lines), ...array_map(Num::money(...), $totals)],
        ]);
    }

    private function query(ReportFilters $f, string $asOf): Builder
    {
        $counted = [...InvoiceStatus::booked(), InvoiceStatus::Reversed->value];
        $drafts = [InvoiceStatus::Draft->value, InvoiceStatus::PendingApproval->value];
        $live = '(i.status = ANY(?::text[]) AND i.document_date <= ? AND (i.status <> ? OR i.reversal_date > ?))';
        $bindings = [self::pgArray($counted), $asOf, InvoiceStatus::Reversed->value, $asOf];
        $purchase = InvoiceType::Purchase->value;
        $invoiced = DB::table('purchase_invoice_lines as il')->join('purchase_invoices as i', 'i.id', '=', 'il.document_id')
            ->where('i.company_id', $f->companyId)->where('il.company_id', $f->companyId)->whereNotNull('il.receipt_line_id')
            ->groupBy('il.receipt_line_id')
            ->select('il.receipt_line_id')
            ->selectRaw("coalesce(sum(CASE WHEN i.invoice_type = '{$purchase}' THEN il.quantity ELSE -il.quantity END) FILTER (WHERE {$live}), 0) AS qty", $bindings)
            ->selectRaw("coalesce(sum(CASE WHEN i.invoice_type = '{$purchase}' THEN il.grni_amount ELSE -il.grni_amount END) FILTER (WHERE {$live}), 0) AS value", $bindings)
            ->selectRaw("coalesce(sum(il.quantity) FILTER (WHERE i.invoice_type = '{$purchase}' AND i.status = ANY(?::text[])), 0) AS in_draft", [self::pgArray($drafts)]);
        $returned = DB::table('purchase_return_lines as rl')->join('purchase_returns as r', 'r.id', '=', 'rl.document_id')
            ->where('r.company_id', $f->companyId)->where('rl.company_id', $f->companyId)->whereNotNull('rl.receipt_line_id')
            ->whereIn('r.status', [ReturnStatus::Shipped->value, ReturnStatus::Debited->value])->where('r.document_date', '<=', $asOf)
            ->groupBy('rl.receipt_line_id')
            ->select('rl.receipt_line_id')
            ->selectRaw('coalesce(sum(rl.quantity), 0) AS qty, coalesce(sum(rl.receipt_cost), 0) AS value');

        $counted = '(r.document_date <= ? AND (r.status = ? OR (r.status = ? AND r.reversal_date > ?)))';
        $countedBindings = [$asOf, ReceiptStatus::Posted->value, ReceiptStatus::Cancelled->value, $asOf];

        return DB::table('purchase_receipt_lines as l')->join('purchase_receipts as r', 'r.id', '=', 'l.document_id')
            ->leftJoin('purchase_orders as o', fn (JoinClause $j) => $j->on('o.id', '=', 'r.order_id')->where('o.company_id', '=', $f->companyId))
            ->leftJoinSub($invoiced, 'inv', 'inv.receipt_line_id', '=', 'l.id')
            ->leftJoinSub($returned, 'ret', 'ret.receipt_line_id', '=', 'l.id')
            ->where('r.company_id', $f->companyId)->where('l.company_id', $f->companyId)->whereNotNull('r.posted_at')
            // Receipts that count as of the date, and receipt lines whose invoices or returns already do
            // (a supplier invoice may be dated before the goods arrived).
            ->where(fn (Builder $q) => $q->whereRaw($counted, $countedBindings)
                ->orWhereRaw('coalesce(inv.qty, 0) <> 0 OR coalesce(inv.value, 0) <> 0 OR coalesce(ret.qty, 0) <> 0 OR coalesce(ret.value, 0) <> 0'))
            ->when($f->dateFrom !== null, fn (Builder $q) => $q->where('r.document_date', '>=', $f->dateFrom))
            ->when($f->dateTo !== null, fn (Builder $q) => $q->where('r.document_date', '<=', $f->dateTo))
            ->when($f->partyId !== null, fn (Builder $q) => $q->where('r.party_id', $f->partyId))
            ->when($f->currencyCode !== null, fn (Builder $q) => $q->where('r.currency_code', $f->currencyCode))
            ->when($f->itemId !== null, fn (Builder $q) => $q->where('l.item_id', $f->itemId))
            ->when($f->warehouseId !== null, fn (Builder $q) => $q->whereRaw('coalesce(l.warehouse_id, r.warehouse_id) = ?', [$f->warehouseId]))
            ->select(['l.id', 'l.document_id as receipt_id', 'l.line_no', 'l.item_id', 'l.unit_id', 'l.quantity', 'l.base_quantity', 'l.cost_total',
                'r.number', 'r.document_date', 'r.order_id', 'o.number as order_number', 'r.party_id', 'r.party_name', 'r.currency_code',
                DB::raw('coalesce(l.warehouse_id, r.warehouse_id) AS warehouse_id'),
                DB::raw('coalesce(inv.qty, 0) AS invoiced_qty'), DB::raw('coalesce(inv.value, 0) AS invoiced_value'), DB::raw('coalesce(inv.in_draft, 0) AS in_draft'),
                DB::raw('coalesce(ret.qty, 0) AS returned_qty'), DB::raw('coalesce(ret.value, 0) AS returned_value')])
            ->selectRaw("CASE WHEN {$counted} THEN 1 ELSE 0 END AS counted", $countedBindings);
    }

    /**
     * Postgres array literal of enum values (plain lowercase words, nothing to escape).
     *
     * @param  list<string>  $values
     */
    private static function pgArray(array $values): string
    {
        return '{'.implode(',', $values).'}';
    }
}
