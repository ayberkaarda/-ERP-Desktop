<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Reports\Services;

use App\Modules\Purchasing\Enums\RfqStatus;
use App\Modules\Purchasing\Reports\Data\ReportFilters;
use App\Modules\Purchasing\Reports\Data\ReportTable;
use App\Modules\Purchasing\Reports\Support\Grouper;
use App\Modules\Purchasing\Reports\Support\Num;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Savings of awarded RFQs dated in the range, per awarded line, in the RFQ currency (RFQs carry no
 * exchange rate): net quote price = unit price less discount (scale 6, as the comparison computes
 * it); values = price x line quantity in cents. savings_vs_highest = highest quote value - awarded
 * value, savings_vs_average = average quote value - awarded value, premium_vs_lowest = awarded value
 * - lowest quote value (0 when the lowest quote won); estimated_value / savings_vs_estimate come from
 * the request line's estimated price when the RFQ is in the request's currency (else null).
 * Filters: supplier = the awarded supplier, item, currency, warehouse (the RFQ's), category.
 * Groups: rfq (default), line, supplier (per currency); meta.by_currency totals per currency.
 */
final class RfqSavingsReport
{
    public const array GROUPS = ['rfq', 'line', 'supplier'];

    private const int CHUNK = 500;

    private const array MONEY = ['awarded_value', 'lowest_value', 'highest_value', 'average_value', 'estimated_value',
        'savings_vs_highest', 'savings_vs_average', 'savings_vs_estimate', 'premium_vs_lowest'];

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

    public function build(ReportFilters $f, string $by): ReportTable
    {
        $lines = [];

        $this->query($f)->chunkById(self::CHUNK, function (Collection $chunk) use ($f, &$lines): void {
            if ($f->categoryId !== null) {
                $this->items->preload($chunk->pluck('item_id'));
            }

            $quotes = DB::table('purchase_rfq_quotes')->where('company_id', $f->companyId)->whereIn('rfq_line_id', $chunk->pluck('id')->all())
                ->get(['rfq_line_id', 'unit_price', 'discount_percent'])->groupBy('rfq_line_id');

            foreach ($chunk as $row) {
                if ($f->categoryId !== null && $this->items->categoryOf((string) $row->item_id) !== $f->categoryId) {
                    continue;
                }

                $nets = array_values(($quotes->get($row->id) ?? collect())->map(static fn (stdClass $q): BigDecimal => self::net($q->unit_price, $q->discount_percent))->all());

                if ($nets === []) {
                    continue;
                }

                $lines[] = $this->line($row, $nets);
            }
        }, 'l.id', 'id');

        usort($lines, static fn (array $a, array $b): int => [$a['document_date'], (string) $a['rfq_number'], $a['line_no']] <=> [$b['document_date'], (string) $b['rfq_number'], $b['line_no']]);
        $columns = self::columns($by);
        $rows = match ($by) {
            'line' => $lines,
            'rfq' => PurchaseGroupReport::sortBy(Grouper::group($lines, $columns, ['rfq_id'], self::MONEY, [], ['supplier_count' => 'party_id']), 'savings_vs_highest'),
            default => PurchaseGroupReport::sortBy(Grouper::group($lines, $columns, ['party_id', 'currency_code'], self::MONEY, [], ['rfq_count' => 'rfq_id']), 'savings_vs_highest'),
        };

        return new ReportTable($rows, $columns, [
            'group_by' => $by,
            'totals' => ['rfq_count' => count(array_unique(array_column($lines, 'rfq_id'))), 'line_count' => count($lines)],
            'by_currency' => self::byCurrency($lines),
        ]);
    }

    /**
     * @param  list<BigDecimal>  $nets  net prices of every quote on the line
     * @return array<string, string|int|null>
     */
    private function line(stdClass $row, array $nets): array
    {
        $qty = Num::dec($row->quantity);
        $awardedPrice = self::net($row->awarded_price, $row->awarded_discount);
        $lowest = BigDecimal::min(...$nets);
        $highest = BigDecimal::max(...$nets);
        $sum = array_reduce($nets, static fn (BigDecimal $c, BigDecimal $n): BigDecimal => $c->plus($n), BigDecimal::zero());
        $average = $sum->dividedBy(count($nets), 6, RoundingMode::HalfUp);
        $value = static fn (BigDecimal $price): BigDecimal => Num::cents($price->multipliedBy($qty));
        $awarded = $value($awardedPrice);
        $estimate = $row->estimated_price !== null && $row->request_currency === $row->currency_code ? $value(Num::dec($row->estimated_price)) : null;

        return [
            'rfq_id' => (string) $row->rfq_id, 'rfq_number' => $row->number, 'document_date' => (string) $row->document_date, 'line_no' => (int) $row->line_no,
            'item_id' => (string) $row->item_id, 'item_code' => null, 'item_name' => null, 'party_id' => (string) $row->awarded_party_id,
            'party_code' => null, 'party_name' => $row->party_name, 'currency_code' => (string) $row->currency_code, 'quantity' => Num::qty($qty),
            'quote_count' => count($nets), 'awarded_unit_price' => Num::qty($awardedPrice), 'lowest_unit_price' => Num::qty($lowest),
            'highest_unit_price' => Num::qty($highest), 'average_unit_price' => Num::qty($average),
            'awarded_value' => Num::money($awarded), 'lowest_value' => Num::money($value($lowest)), 'highest_value' => Num::money($value($highest)),
            'average_value' => Num::money($value($average)), 'estimated_value' => $estimate === null ? null : Num::money($estimate),
            'savings_vs_highest' => Num::money($value($highest)->minus($awarded)), 'savings_vs_average' => Num::money($value($average)->minus($awarded)),
            'savings_vs_estimate' => $estimate === null ? null : Num::money($estimate->minus($awarded)),
            'premium_vs_lowest' => Num::money($awarded->minus($value($lowest))),
        ];
    }

    /** Quote net price as the RFQ comparison computes it. */
    private static function net(mixed $price, mixed $discount): BigDecimal
    {
        return Num::dec($price)->multipliedBy(BigDecimal::of(100)->minus(Num::dec($discount)))->dividedBy(100, 6, RoundingMode::HalfUp);
    }

    /**
     * @param  list<array<string, string|int|null>>  $lines
     * @return list<array<string, string|int|null>>
     */
    private static function byCurrency(array $lines): array
    {
        $columns = ['currency_code', 'line_count', 'awarded_value', 'highest_value', 'average_value', 'savings_vs_highest', 'savings_vs_average', 'premium_vs_lowest'];
        $rows = Grouper::group($lines, $columns, ['currency_code'], array_slice($columns, 2));
        usort($rows, static fn (array $a, array $b): int => (string) $a['currency_code'] <=> (string) $b['currency_code']);

        return array_map(static fn (array $r): array => [...$r, 'savings_percent' => Num::percent(Num::dec($r['savings_vs_highest']), Num::dec($r['highest_value']))], $rows);
    }

    private function query(ReportFilters $f): Builder
    {
        return DB::table('purchase_rfq_lines as l')->join('purchase_rfqs as r', 'r.id', '=', 'l.document_id')
            ->join('purchase_rfq_quotes as q', fn (JoinClause $j) => $j->on('q.id', '=', 'l.awarded_quote_id')->where('q.company_id', '=', $f->companyId))
            ->leftJoin('purchase_rfq_suppliers as s', fn (JoinClause $j) => $j->on('s.rfq_id', '=', 'r.id')->on('s.party_id', '=', 'l.awarded_party_id')
                ->where('s.company_id', '=', $f->companyId))
            ->leftJoin('purchase_request_lines as rql', fn (JoinClause $j) => $j->on('rql.id', '=', 'l.request_line_id')->where('rql.company_id', '=', $f->companyId))
            ->leftJoin('purchase_requests as rq', fn (JoinClause $j) => $j->on('rq.id', '=', 'rql.document_id')->where('rq.company_id', '=', $f->companyId))
            ->where('r.company_id', $f->companyId)->where('l.company_id', $f->companyId)
            ->where('r.status', RfqStatus::Awarded->value)->whereNotNull('l.awarded_party_id')
            ->whereBetween('r.document_date', [(string) $f->dateFrom, (string) $f->dateTo])
            ->when($f->partyId !== null, fn (Builder $q) => $q->where('l.awarded_party_id', $f->partyId))
            ->when($f->currencyCode !== null, fn (Builder $q) => $q->where('r.currency_code', $f->currencyCode))
            ->when($f->itemId !== null, fn (Builder $q) => $q->where('l.item_id', $f->itemId))
            ->when($f->warehouseId !== null, fn (Builder $q) => $q->where('r.warehouse_id', $f->warehouseId))
            ->select(['l.id', 'l.document_id as rfq_id', 'l.line_no', 'l.item_id', 'l.quantity', 'l.awarded_party_id', 'r.number', 'r.document_date',
                'r.currency_code', 's.party_name', 'q.unit_price as awarded_price', 'q.discount_percent as awarded_discount',
                'rql.estimated_price', 'rq.currency_code as request_currency']);
    }
}
