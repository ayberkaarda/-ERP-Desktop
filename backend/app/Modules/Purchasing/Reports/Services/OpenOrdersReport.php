<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Reports\Services;

use App\Modules\Purchasing\Enums\OrderStatus;
use App\Modules\Purchasing\Reports\Data\ReportFilters;
use App\Modules\Purchasing\Reports\Data\ReportTable;
use App\Modules\Purchasing\Reports\Support\Num;
use App\Modules\Purchasing\Reports\Support\Sql;
use App\Modules\Purchasing\Reports\Support\Window;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Purchase order backlog now: lines of approved, sent, partially received, received and partially
 * invoiced orders (drafts, pending approval, invoiced, closed and cancelled orders excluded) with a
 * quantity still to receive; for lines that are never received (not stock) the quantity still to
 * invoice. open_value = net_amount x open / quantity in the order currency (excluding VAT, cents),
 * open_value_local = open_value x order fx_rate (cents). expected_date is the line's, else the
 * order's; days_late counts from it to `today`. The optional date range filters on the order date.
 * Groups: line (default), order, supplier, item; lines oldest expected date first, groups by value.
 * Computed in SQL: only the requested page of rows (or groups) is read.
 */
final class OpenOrdersReport
{
    public const array GROUPS = ['line', 'order', 'supplier', 'item'];

    private const array MONEY = ['open_value', 'open_value_local'];

    private const array QUANTITIES = ['fx_rate', 'quantity', 'received_quantity', 'invoiced_quantity', 'open_quantity', 'open_base_quantity'];

    private const array INTEGERS = ['days_late', 'line_no', 'line_count', 'order_count'];

    public function __construct(private readonly ItemDirectory $items) {}

    /** @return list<string> */
    public static function columns(string $by): array
    {
        return match ($by) {
            'line' => ['order_id', 'order_number', 'order_status', 'document_date', 'expected_date', 'days_late', 'party_id', 'party_name',
                'line_no', 'item_id', 'item_code', 'item_name', 'item_type', 'unit_id', 'warehouse_id', 'currency_code', 'fx_rate',
                'quantity', 'received_quantity', 'invoiced_quantity', 'open_quantity', 'open_base_quantity', 'open_value', 'open_value_local'],
            'order' => ['order_id', 'order_number', 'order_status', 'document_date', 'expected_date', 'days_late', 'party_id', 'party_name',
                'currency_code', 'line_count', 'open_value', 'open_value_local'],
            'supplier' => ['party_id', 'party_code', 'party_name', 'order_count', 'line_count', 'open_value_local'],
            default => ['item_id', 'item_code', 'item_name', 'order_count', 'line_count', 'open_base_quantity', 'open_value_local'],
        };
    }

    public function build(ReportFilters $f, string $by, string $today, Window $window): ReportTable
    {
        $lines = DB::query()->fromSub($this->lines($f, $today), 't')->where('t.open_quantity', '>', 0);
        $totals = (clone $lines)->selectRaw('count(*) AS line_count, count(DISTINCT t.order_id) AS order_count, coalesce(sum(t.open_value_local), 0) AS local')->first();
        $currencies = (clone $lines)->groupBy('t.currency_code')->orderBy('t.currency_code')->selectRaw('t.currency_code, sum(t.open_value) AS value')->get();
        $columns = self::columns($by);

        if ($by === 'line') {
            $ordered = $lines->select('t.*')->orderByRaw('t.expected_date ASC NULLS LAST')->orderBy('t.document_date')->orderBy('t.order_number')
                ->orderBy('t.line_no')->orderBy('t.id');
            $total = (int) ($totals->line_count ?? 0);
        } else {
            $groups = match ($by) {
                'order' => $lines->groupBy('t.order_id', 't.order_number', 't.order_status', 't.document_date', 't.party_id', 't.party_name', 't.currency_code')
                    ->selectRaw('t.order_id AS group_key, t.order_id, t.order_number, t.order_status, t.document_date, min(t.expected_date) AS expected_date,
                        max(t.days_late) AS days_late, t.party_id, t.party_name, t.currency_code, count(*) AS line_count,
                        sum(t.open_value) AS open_value, sum(t.open_value_local) AS open_value_local'),
                'supplier' => $lines->groupBy('t.party_id')
                    ->selectRaw('t.party_id AS group_key, t.party_id, (array_agg(t.party_name ORDER BY t.document_date DESC, t.order_number DESC))[1] AS party_name,
                        count(DISTINCT t.order_id) AS order_count, count(*) AS line_count, sum(t.open_value_local) AS open_value_local'),
                default => $lines->groupBy('t.item_id')
                    ->selectRaw('t.item_id AS group_key, t.item_id, count(DISTINCT t.order_id) AS order_count, count(*) AS line_count,
                        sum(t.open_base_quantity) AS open_base_quantity, sum(t.open_value_local) AS open_value_local'),
            };
            $total = Sql::count($groups);
            $ordered = DB::query()->fromSub($groups, 'g')->orderByDesc('g.open_value_local')->orderBy('g.group_key');
        }

        return new ReportTable(Sql::window($ordered, $window, $total, $columns, self::MONEY, self::QUANTITIES, self::INTEGERS), $columns, [
            'today' => $today,
            'group_by' => $by,
            'totals' => ['order_count' => (int) ($totals->order_count ?? 0), 'line_count' => (int) ($totals->line_count ?? 0),
                'open_value_local' => Num::money(Num::dec($totals->local ?? '0'))],
            'by_currency' => $currencies->map(static fn (object $c): array => ['currency_code' => (string) $c->currency_code, 'open_value' => Num::money(Num::dec($c->value))])->values()->all(),
        ], $total);
    }

    /** One row per open order line with its open quantity and values (in SQL, cents rounded half up). */
    private function lines(ReportFilters $f, string $today): Builder
    {
        $open = '(l.quantity - CASE WHEN l.item_type = \'stock\' THEN l.received_quantity ELSE l.invoiced_quantity END)';
        $value = "round(l.net_amount * {$open} / l.quantity, 2)";

        return DB::table('purchase_order_lines as l')->join('purchase_orders as o', 'o.id', '=', 'l.document_id')
            ->where('o.company_id', $f->companyId)->where('l.company_id', $f->companyId)
            ->whereIn('o.status', OrderStatus::openValues())
            ->when($f->dateFrom !== null, fn (Builder $q) => $q->where('o.document_date', '>=', $f->dateFrom))
            ->when($f->dateTo !== null, fn (Builder $q) => $q->where('o.document_date', '<=', $f->dateTo))
            ->when($f->partyId !== null, fn (Builder $q) => $q->where('o.party_id', $f->partyId))
            ->when($f->currencyCode !== null, fn (Builder $q) => $q->where('o.currency_code', $f->currencyCode))
            ->when($f->itemId !== null, fn (Builder $q) => $q->where('l.item_id', $f->itemId))
            ->when($f->categoryId !== null, fn (Builder $q) => $q->whereRaw('l.item_id = ANY(?::uuid[])', [$this->items->inCategory(
                DB::table('purchase_order_lines')->where('company_id', $f->companyId)->select('item_id'), (string) $f->categoryId,
            )]))
            ->when($f->warehouseId !== null, fn (Builder $q) => $q->whereRaw('coalesce(l.warehouse_id, o.warehouse_id) = ?', [$f->warehouseId]))
            ->select(['l.id', 'l.document_id as order_id', 'l.line_no', 'l.item_id', 'l.item_type', 'l.unit_id', 'l.quantity',
                'l.received_quantity', 'l.invoiced_quantity', 'o.number as order_number', 'o.status as order_status', 'o.document_date',
                'o.party_id', 'o.party_name', 'o.currency_code', 'o.fx_rate'])
            ->selectRaw('coalesce(l.expected_date, o.expected_date) AS expected_date')
            ->selectRaw('coalesce(greatest(?::date - coalesce(l.expected_date, o.expected_date), 0), 0) AS days_late', [$today])
            ->selectRaw('coalesce(l.warehouse_id, o.warehouse_id) AS warehouse_id')
            ->selectRaw("{$open} AS open_quantity")
            ->selectRaw("round(l.base_quantity * {$open} / l.quantity, 6) AS open_base_quantity")
            ->selectRaw("{$value} AS open_value")
            ->selectRaw("round({$value} * o.fx_rate, 2) AS open_value_local");
    }
}
