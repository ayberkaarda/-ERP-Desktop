<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Reports\Services;

use App\Modules\Purchasing\Enums\RfqStatus;
use App\Modules\Purchasing\Reports\Data\ReportFilters;
use App\Modules\Purchasing\Reports\Data\ReportTable;
use App\Modules\Purchasing\Reports\Support\Num;
use App\Modules\Purchasing\Reports\Support\Sql;
use App\Modules\Purchasing\Reports\Support\Window;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Facades\DB;

/**
 * Savings of awarded RFQs dated in the range, per awarded line, in the RFQ currency (RFQs carry no
 * exchange rate): net quote price = unit price less discount (scale 6, as the comparison computes
 * it); values = price x line quantity in cents. savings_vs_highest = highest quote value - awarded
 * value, savings_vs_average = average quote value - awarded value, premium_vs_lowest = awarded value
 * - lowest quote value (0 when the lowest quote won); estimated_value / savings_vs_estimate come from
 * the request line's estimated price when the RFQ is in the request's currency (else null; group
 * sums stay null when no line has one).
 * Filters: supplier = the awarded supplier, item, currency, warehouse (the RFQ's), category.
 * Groups: rfq (default), line, supplier (per currency); meta.by_currency totals per currency.
 * Computed in SQL: only the requested page of rows (or groups) is read.
 */
final class RfqSavingsReport
{
    public const array GROUPS = ['rfq', 'line', 'supplier'];

    private const array MONEY = ['awarded_value', 'lowest_value', 'highest_value', 'average_value', 'estimated_value',
        'savings_vs_highest', 'savings_vs_average', 'savings_vs_estimate', 'premium_vs_lowest'];

    private const array QUANTITIES = ['quantity', 'awarded_unit_price', 'lowest_unit_price', 'highest_unit_price', 'average_unit_price'];

    private const array INTEGERS = ['line_no', 'quote_count', 'line_count', 'supplier_count', 'rfq_count'];

    private const array CURRENCY_MONEY = ['awarded_value', 'highest_value', 'average_value', 'savings_vs_highest', 'savings_vs_average', 'premium_vs_lowest'];

    public function __construct(private readonly ItemDirectory $items) {}

    /** @return list<string> */
    public static function columns(string $by): array
    {
        return match ($by) {
            'line' => ['rfq_id', 'rfq_number', 'document_date', 'line_no', 'item_id', 'item_code', 'item_name', 'party_id', 'party_code', 'party_name',
                'currency_code', 'quantity', 'quote_count', 'awarded_unit_price', 'lowest_unit_price', 'highest_unit_price', 'average_unit_price', ...self::MONEY],
            'rfq' => ['rfq_id', 'rfq_number', 'document_date', 'currency_code', 'line_count', 'supplier_count', ...self::MONEY],
            default => ['party_id', 'party_code', 'party_name', 'currency_code', 'rfq_count', 'line_count', ...self::MONEY],
        };
    }

    public function build(ReportFilters $f, string $by, Window $window): ReportTable
    {
        $lines = DB::query()->fromSub($this->lines($f), 't');
        $sums = implode(', ', array_map(
            static fn (string $c): string => in_array($c, ['estimated_value', 'savings_vs_estimate'], true) ? "sum(t.{$c}) AS {$c}" : "coalesce(sum(t.{$c}), 0) AS {$c}",
            self::MONEY,
        ));
        $totals = (clone $lines)->selectRaw('count(DISTINCT t.rfq_id) AS rfq_count, count(*) AS line_count')->first();
        $currencies = (clone $lines)->groupBy('t.currency_code')->orderBy('t.currency_code')->selectRaw("t.currency_code, count(*) AS line_count, {$sums}")->get();
        $columns = self::columns($by);

        if ($by === 'line') {
            $ordered = $lines->select('t.*')->orderBy('t.document_date')->orderBy('t.rfq_number')->orderBy('t.line_no')->orderBy('t.id');
            $total = (int) ($totals->line_count ?? 0);
        } else {
            $groups = $by === 'rfq'
                ? $lines->groupBy('t.rfq_id', 't.rfq_number', 't.document_date', 't.currency_code')
                    ->selectRaw("t.rfq_id AS group_key, t.rfq_id, t.rfq_number, t.document_date, t.currency_code, count(*) AS line_count,
                        count(DISTINCT t.party_id) AS supplier_count, {$sums}")
                : $lines->groupBy('t.party_id', 't.currency_code')
                    ->selectRaw("t.party_id || '|' || t.currency_code AS group_key, t.party_id, t.currency_code,
                        (array_agg(t.party_name ORDER BY t.document_date DESC, t.rfq_number DESC))[1] AS party_name,
                        count(DISTINCT t.rfq_id) AS rfq_count, count(*) AS line_count, {$sums}");
            $total = Sql::count($groups);
            $ordered = DB::query()->fromSub($groups, 'g')->orderByDesc('g.savings_vs_highest')->orderBy('g.group_key');
        }

        return new ReportTable(Sql::window($ordered, $window, $total, $columns, self::MONEY, self::QUANTITIES, self::INTEGERS), $columns, [
            'group_by' => $by,
            'totals' => ['rfq_count' => (int) ($totals->rfq_count ?? 0), 'line_count' => (int) ($totals->line_count ?? 0)],
            'by_currency' => $currencies->map(static function (object $c): array {
                $row = Sql::shape($c, ['currency_code', 'line_count', ...self::CURRENCY_MONEY], self::CURRENCY_MONEY, [], ['line_count']);

                return [...$row, 'savings_percent' => Num::percent(Num::dec($row['savings_vs_highest']), Num::dec($row['highest_value']))];
            })->values()->all(),
        ], $total);
    }

    /** One row per awarded RFQ line with its quote statistics (in SQL, as the comparison computes nets). */
    private function lines(ReportFilters $f): Builder
    {
        $net = 'round(%s.unit_price * (100 - %s.discount_percent) / 100, 6)';
        $quoteNet = sprintf($net, 'qq', 'qq');
        $stats = DB::table('purchase_rfq_quotes as qq')->where('qq.company_id', $f->companyId)->groupBy('qq.rfq_line_id')
            ->selectRaw("qq.rfq_line_id, count(*) AS quote_count, min({$quoteNet}) AS lowest, max({$quoteNet}) AS highest, round(avg({$quoteNet}), 6) AS average");
        $awarded = sprintf($net, 'q', 'q');
        $estimate = 'CASE WHEN rql.estimated_price IS NOT NULL AND rq.currency_code = r.currency_code THEN round(rql.estimated_price * l.quantity, 2) END';

        return DB::table('purchase_rfq_lines as l')->join('purchase_rfqs as r', 'r.id', '=', 'l.document_id')
            ->join('purchase_rfq_quotes as q', fn (JoinClause $j) => $j->on('q.id', '=', 'l.awarded_quote_id')->where('q.company_id', '=', $f->companyId))
            ->joinSub($stats, 's', 's.rfq_line_id', '=', 'l.id')
            ->leftJoin('purchase_rfq_suppliers as rs', fn (JoinClause $j) => $j->on('rs.rfq_id', '=', 'r.id')->on('rs.party_id', '=', 'l.awarded_party_id')
                ->where('rs.company_id', '=', $f->companyId))
            ->leftJoin('purchase_request_lines as rql', fn (JoinClause $j) => $j->on('rql.id', '=', 'l.request_line_id')->where('rql.company_id', '=', $f->companyId))
            ->leftJoin('purchase_requests as rq', fn (JoinClause $j) => $j->on('rq.id', '=', 'rql.document_id')->where('rq.company_id', '=', $f->companyId))
            ->where('r.company_id', $f->companyId)->where('l.company_id', $f->companyId)
            ->where('r.status', RfqStatus::Awarded->value)->whereNotNull('l.awarded_party_id')
            ->whereBetween('r.document_date', [(string) $f->dateFrom, (string) $f->dateTo])
            ->when($f->partyId !== null, fn (Builder $q) => $q->where('l.awarded_party_id', $f->partyId))
            ->when($f->currencyCode !== null, fn (Builder $q) => $q->where('r.currency_code', $f->currencyCode))
            ->when($f->itemId !== null, fn (Builder $q) => $q->where('l.item_id', $f->itemId))
            ->when($f->categoryId !== null, fn (Builder $q) => $q->whereRaw('l.item_id = ANY(?::uuid[])', [$this->items->inCategory(
                DB::table('purchase_rfq_lines')->where('company_id', $f->companyId)->select('item_id'), (string) $f->categoryId,
            )]))
            ->when($f->warehouseId !== null, fn (Builder $q) => $q->where('r.warehouse_id', $f->warehouseId))
            ->select(['l.id', 'l.document_id as rfq_id', 'r.number as rfq_number', 'r.document_date', 'l.line_no', 'l.item_id',
                'l.awarded_party_id as party_id', 'rs.party_name', 'r.currency_code', 'l.quantity', 's.quote_count'])
            ->selectRaw("{$awarded} AS awarded_unit_price, s.lowest AS lowest_unit_price, s.highest AS highest_unit_price, s.average AS average_unit_price")
            ->selectRaw("round({$awarded} * l.quantity, 2) AS awarded_value, round(s.lowest * l.quantity, 2) AS lowest_value,
                round(s.highest * l.quantity, 2) AS highest_value, round(s.average * l.quantity, 2) AS average_value, {$estimate} AS estimated_value")
            ->selectRaw("round(s.highest * l.quantity, 2) - round({$awarded} * l.quantity, 2) AS savings_vs_highest,
                round(s.average * l.quantity, 2) - round({$awarded} * l.quantity, 2) AS savings_vs_average,
                {$estimate} - round({$awarded} * l.quantity, 2) AS savings_vs_estimate,
                round({$awarded} * l.quantity, 2) - round(s.lowest * l.quantity, 2) AS premium_vs_lowest");
    }
}
