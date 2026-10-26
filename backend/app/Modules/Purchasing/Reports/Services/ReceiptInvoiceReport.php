<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Reports\Services;

use App\Modules\Purchasing\Enums\InvoiceStatus;
use App\Modules\Purchasing\Enums\InvoiceType;
use App\Modules\Purchasing\Enums\ReceiptStatus;
use App\Modules\Purchasing\Enums\ReturnStatus;
use App\Modules\Purchasing\Reports\Data\ReportFilters;
use App\Modules\Purchasing\Reports\Data\ReportTable;
use App\Modules\Purchasing\Reports\Support\Num;
use App\Modules\Purchasing\Reports\Support\Sql;
use App\Modules\Purchasing\Reports\Support\Window;
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
 * Computed in SQL: only the requested page of rows (or groups) is read.
 */
final class ReceiptInvoiceReport
{
    public const array GROUPS = ['line', 'receipt', 'supplier', 'item'];

    private const array MONEY = ['received_value', 'invoiced_value', 'returned_value', 'uninvoiced_value'];

    private const array QUANTITIES = ['received_quantity', 'invoiced_quantity', 'returned_quantity', 'uninvoiced_quantity', 'in_draft_quantity', 'uninvoiced_base_quantity'];

    private const array INTEGERS = ['days_open', 'line_no', 'line_count', 'receipt_count'];

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

    public function build(ReportFilters $f, string $by, Window $window): ReportTable
    {
        $asOf = (string) $f->asOf;
        $lines = DB::query()->fromSub($this->lines($f, $asOf), 't')->where(fn (Builder $q) => $q->where('t.uninvoiced_quantity', '<>', 0)->orWhere('t.uninvoiced_value', '<>', 0));
        $sums = 'coalesce(sum(t.received_value), 0) AS received_value, coalesce(sum(t.invoiced_value), 0) AS invoiced_value,
            coalesce(sum(t.returned_value), 0) AS returned_value, coalesce(sum(t.uninvoiced_value), 0) AS uninvoiced_value';
        $totals = (clone $lines)->selectRaw("count(DISTINCT t.receipt_id) AS receipt_count, count(*) AS line_count, {$sums}")->first();
        $columns = self::columns($by);

        if ($by === 'line') {
            $ordered = $lines->select('t.*')->orderBy('t.document_date')->orderBy('t.receipt_number')->orderBy('t.line_no')->orderBy('t.id');
            $total = (int) ($totals->line_count ?? 0);
        } else {
            $groups = match ($by) {
                'receipt' => $lines->groupBy('t.receipt_id', 't.receipt_number', 't.document_date', 't.order_id', 't.order_number', 't.party_id', 't.party_name', 't.currency_code')
                    ->selectRaw("t.receipt_id AS group_key, t.receipt_id, t.receipt_number, t.document_date, max(t.days_open) AS days_open, t.order_id,
                        t.order_number, t.party_id, t.party_name, t.currency_code, count(*) AS line_count, {$sums}"),
                'supplier' => $lines->groupBy('t.party_id')
                    ->selectRaw("t.party_id AS group_key, t.party_id, (array_agg(t.party_name ORDER BY t.document_date DESC, t.receipt_number DESC))[1] AS party_name,
                        count(DISTINCT t.receipt_id) AS receipt_count, count(*) AS line_count, {$sums}"),
                default => $lines->groupBy('t.item_id')
                    ->selectRaw("t.item_id AS group_key, t.item_id, count(DISTINCT t.receipt_id) AS receipt_count, count(*) AS line_count,
                        sum(t.uninvoiced_base_quantity) AS uninvoiced_base_quantity, {$sums}"),
            };
            $total = Sql::count($groups);
            $ordered = DB::query()->fromSub($groups, 'g')->orderByDesc('g.uninvoiced_value')->orderBy('g.group_key');
        }

        return new ReportTable(Sql::window($ordered, $window, $total, $columns, self::MONEY, self::QUANTITIES, self::INTEGERS), $columns, [
            'as_of' => $asOf,
            'group_by' => $by,
            'totals' => [
                'receipt_count' => (int) ($totals->receipt_count ?? 0), 'line_count' => (int) ($totals->line_count ?? 0),
                ...array_combine(self::MONEY, array_map(static fn (string $c): string => Num::money(Num::dec($totals->{$c} ?? '0')), self::MONEY)),
            ],
        ], $total);
    }

    /** One row per receipt line with what was received, invoiced and returned as of the date. */
    private function lines(ReportFilters $f, string $asOf): Builder
    {
        $booked = [...InvoiceStatus::booked(), InvoiceStatus::Reversed->value];
        $drafts = [InvoiceStatus::Draft->value, InvoiceStatus::PendingApproval->value];
        $live = '(i.status = ANY(?::text[]) AND i.document_date <= ? AND (i.status <> ? OR i.reversal_date > ?))';
        $bindings = ['{'.implode(',', $booked).'}', $asOf, InvoiceStatus::Reversed->value, $asOf];
        $purchase = InvoiceType::Purchase->value;
        $invoiced = DB::table('purchase_invoice_lines as il')->join('purchase_invoices as i', 'i.id', '=', 'il.document_id')
            ->where('i.company_id', $f->companyId)->where('il.company_id', $f->companyId)->whereNotNull('il.receipt_line_id')
            ->groupBy('il.receipt_line_id')
            ->select('il.receipt_line_id')
            ->selectRaw("coalesce(sum(CASE WHEN i.invoice_type = '{$purchase}' THEN il.quantity ELSE -il.quantity END) FILTER (WHERE {$live}), 0) AS qty", $bindings)
            ->selectRaw("coalesce(sum(CASE WHEN i.invoice_type = '{$purchase}' THEN il.grni_amount ELSE -il.grni_amount END) FILTER (WHERE {$live}), 0) AS value", $bindings)
            ->selectRaw("coalesce(sum(il.quantity) FILTER (WHERE i.invoice_type = '{$purchase}' AND i.status = ANY(?::text[])), 0) AS in_draft", ['{'.implode(',', $drafts).'}']);
        $returned = DB::table('purchase_return_lines as rl')->join('purchase_returns as r', 'r.id', '=', 'rl.document_id')
            ->where('r.company_id', $f->companyId)->where('rl.company_id', $f->companyId)->whereNotNull('rl.receipt_line_id')
            ->whereIn('r.status', [ReturnStatus::Shipped->value, ReturnStatus::Debited->value])->where('r.document_date', '<=', $asOf)
            ->groupBy('rl.receipt_line_id')
            ->select('rl.receipt_line_id')
            ->selectRaw('coalesce(sum(rl.quantity), 0) AS qty, coalesce(sum(rl.receipt_cost), 0) AS value');

        // A receipt counts from its date until its stock reversal; lines whose invoices or returns
        // already count (a supplier invoice may be dated before the goods arrived) are read too.
        $counted = '(r.document_date <= ? AND (r.status = ? OR (r.status = ? AND r.reversal_date > ?)))';
        $cb = [$asOf, ReceiptStatus::Posted->value, ReceiptStatus::Cancelled->value, $asOf];
        $received = "(CASE WHEN {$counted} THEN l.quantity ELSE 0 END)";
        $open = "({$received} - coalesce(inv.qty, 0) - coalesce(ret.qty, 0))";
        $value = "(CASE WHEN {$counted} THEN coalesce(l.cost_total, 0) ELSE 0 END)";

        return DB::table('purchase_receipt_lines as l')->join('purchase_receipts as r', 'r.id', '=', 'l.document_id')
            ->leftJoin('purchase_orders as o', fn (JoinClause $j) => $j->on('o.id', '=', 'r.order_id')->where('o.company_id', '=', $f->companyId))
            ->leftJoinSub($invoiced, 'inv', 'inv.receipt_line_id', '=', 'l.id')
            ->leftJoinSub($returned, 'ret', 'ret.receipt_line_id', '=', 'l.id')
            ->where('r.company_id', $f->companyId)->where('l.company_id', $f->companyId)->whereNotNull('r.posted_at')
            ->where(fn (Builder $q) => $q->whereRaw($counted, $cb)
                ->orWhereRaw('coalesce(inv.qty, 0) <> 0 OR coalesce(inv.value, 0) <> 0 OR coalesce(ret.qty, 0) <> 0 OR coalesce(ret.value, 0) <> 0'))
            ->when($f->dateFrom !== null, fn (Builder $q) => $q->where('r.document_date', '>=', $f->dateFrom))
            ->when($f->dateTo !== null, fn (Builder $q) => $q->where('r.document_date', '<=', $f->dateTo))
            ->when($f->partyId !== null, fn (Builder $q) => $q->where('r.party_id', $f->partyId))
            ->when($f->currencyCode !== null, fn (Builder $q) => $q->where('r.currency_code', $f->currencyCode))
            ->when($f->itemId !== null, fn (Builder $q) => $q->where('l.item_id', $f->itemId))
            ->when($f->categoryId !== null, fn (Builder $q) => $q->whereRaw('l.item_id = ANY(?::uuid[])', [$this->items->inCategory(
                DB::table('purchase_receipt_lines')->where('company_id', $f->companyId)->select('item_id'), (string) $f->categoryId,
            )]))
            ->when($f->warehouseId !== null, fn (Builder $q) => $q->whereRaw('coalesce(l.warehouse_id, r.warehouse_id) = ?', [$f->warehouseId]))
            ->select(['l.id', 'l.document_id as receipt_id', 'l.line_no', 'l.item_id', 'l.unit_id', 'r.number as receipt_number', 'r.document_date',
                'r.order_id', 'o.number as order_number', 'r.party_id', 'r.party_name', 'r.currency_code'])
            ->selectRaw('coalesce(l.warehouse_id, r.warehouse_id) AS warehouse_id')
            ->selectRaw("CASE WHEN {$counted} THEN ?::date - r.document_date ELSE 0 END AS days_open", [...$cb, $asOf])
            ->selectRaw("{$received} AS received_quantity", $cb)
            ->selectRaw('coalesce(inv.qty, 0) AS invoiced_quantity, coalesce(ret.qty, 0) AS returned_quantity, coalesce(inv.in_draft, 0) AS in_draft_quantity')
            ->selectRaw("{$open} AS uninvoiced_quantity", $cb)
            ->selectRaw("round(l.base_quantity * {$open} / l.quantity, 6) AS uninvoiced_base_quantity", $cb)
            ->selectRaw("{$value} AS received_value", $cb)
            ->selectRaw('coalesce(inv.value, 0) AS invoiced_value, coalesce(ret.value, 0) AS returned_value')
            ->selectRaw("{$value} - coalesce(inv.value, 0) - coalesce(ret.value, 0) AS uninvoiced_value", $cb);
    }
}
