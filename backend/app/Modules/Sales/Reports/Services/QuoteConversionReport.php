<?php

declare(strict_types=1);

namespace App\Modules\Sales\Reports\Services;

use App\Modules\Sales\Enums\QuoteStatus;
use App\Modules\Sales\Reports\Data\ReportFilters;
use App\Modules\Sales\Reports\Data\ReportTable;
use App\Modules\Sales\Reports\Support\Num;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use DateTimeImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Quote outcomes for the quotes dated in the range. Counted: every quote that left draft and has
 * no newer revision (a superseded revision is skipped, the latest one carries the outcome of the
 * chain once it leaves draft). Statuses: open (sent), accepted (not yet converted), converted, rejected, expired,
 * cancelled. conversion_rate_percent = converted / quotes; value_conversion_rate_percent on the net
 * value in company currency (total_local - tax_total_local); average_days_to_convert from the quote
 * date to the order date. Filters: customer, currency, item (quotes with a line of that item).
 * Groups: none (default, one row), customer, month (of the quote date).
 */
final class QuoteConversionReport
{
    public const array GROUPS = ['none', 'customer', 'month'];

    private const array FIGURES = ['quote_count', 'open_count', 'accepted_count', 'converted_count', 'rejected_count', 'expired_count', 'cancelled_count',
        'quoted_value', 'converted_value', 'conversion_rate_percent', 'value_conversion_rate_percent', 'average_days_to_convert'];

    public function __construct(private readonly ItemDirectory $items) {}

    /** @return list<string> */
    public static function columns(string $by): array
    {
        return match ($by) {
            'customer' => ['party_id', 'party_code', 'party_name', ...self::FIGURES],
            'month' => ['period', ...self::FIGURES],
            default => self::FIGURES,
        };
    }

    public function build(ReportFilters $f, string $by): ReportTable
    {
        $groups = [];
        $all = self::blank();

        foreach ($this->query($f)->lazyById(1000, 'q.id', 'id') as $row) {
            $key = match ($by) {
                'customer' => (string) $row->party_id,
                'month' => substr((string) $row->document_date, 0, 7),
                default => '',
            };
            $groups[$key] ??= [...self::blank(), 'name' => (string) $row->party_name];
            $groups[$key] = self::add($groups[$key], $row);
            $all = self::add($all, $row);
        }

        $rows = [];

        foreach ($groups as $key => $g) {
            $head = match ($by) {
                'customer' => ['party_id' => (string) $key, 'party_code' => null, 'party_name' => $g['name']],
                'month' => ['period' => (string) $key],
                default => [],
            };
            $rows[] = [...$head, ...self::figures($g)];
        }

        if ($by === 'customer') {
            $rows = SalesGroupReport::sortByNet($rows, 'quoted_value');
        } else {
            usort($rows, static fn (array $a, array $b): int => strcmp((string) ($a['period'] ?? ''), (string) ($b['period'] ?? '')));
        }

        if ($by === 'none' && $rows === []) {
            $rows[] = self::figures($all);
        }

        return new ReportTable($rows, self::columns($by), ['group_by' => $by, 'totals' => self::figures($all)]);
    }

    /**
     * @param  list<array<string, string|int|null>>  $rows
     * @return list<array<string, string|int|null>>
     */
    public function decorate(array $rows, string $by): array
    {
        return $by === 'customer' ? $this->items->withParties($rows) : $rows;
    }

    private function query(ReportFilters $f): Builder
    {
        return DB::table('sales_quotes as q')
            ->leftJoin('sales_orders as o', fn (JoinClause $j) => $j->on('o.id', '=', 'q.converted_order_id')->where('o.company_id', '=', $f->companyId))
            ->where('q.company_id', $f->companyId)
            ->where('q.status', '<>', QuoteStatus::Draft->value)
            ->whereBetween('q.document_date', [(string) $f->dateFrom, (string) $f->dateTo])
            ->whereNotExists(fn (Builder $e) => $e->selectRaw('1')->from('sales_quotes as n')->whereColumn('n.previous_revision_id', 'q.id')
                ->where('n.company_id', $f->companyId))
            ->when($f->partyId !== null, fn (Builder $q) => $q->where('q.party_id', $f->partyId))
            ->when($f->currencyCode !== null, fn (Builder $q) => $q->where('q.currency_code', $f->currencyCode))
            ->when($f->itemId !== null, fn (Builder $q) => $q->whereExists(fn (Builder $e) => $e->selectRaw('1')->from('sales_quote_lines as l')
                ->whereColumn('l.document_id', 'q.id')->where('l.company_id', $f->companyId)->where('l.item_id', $f->itemId)))
            ->select(['q.id', 'q.status', 'q.document_date', 'q.party_id', 'q.party_name', 'q.total_local', 'q.tax_total_local', 'o.document_date as order_date']);
    }

    /** @return array{count: int, statuses: array<string, int>, quoted: BigDecimal, converted: BigDecimal, days: int, name: string} */
    private static function blank(): array
    {
        return ['count' => 0, 'statuses' => [], 'quoted' => BigDecimal::zero(), 'converted' => BigDecimal::zero(), 'days' => 0, 'name' => ''];
    }

    /**
     * @param  array{count: int, statuses: array<string, int>, quoted: BigDecimal, converted: BigDecimal, days: int, name: string}  $g
     * @return array{count: int, statuses: array<string, int>, quoted: BigDecimal, converted: BigDecimal, days: int, name: string}
     */
    private static function add(array $g, stdClass $row): array
    {
        $status = (string) $row->status;
        $value = Num::dec($row->total_local)->minus(Num::dec($row->tax_total_local));
        $g['count']++;
        $g['statuses'][$status] = ($g['statuses'][$status] ?? 0) + 1;
        $g['quoted'] = $g['quoted']->plus($value);

        if ($status === QuoteStatus::Converted->value) {
            $g['converted'] = $g['converted']->plus($value);

            if (is_string($row->order_date)) {
                $g['days'] += (int) (new DateTimeImmutable((string) $row->document_date))->diff(new DateTimeImmutable($row->order_date))->days;
            }
        }

        return $g;
    }

    /**
     * @param  array{count: int, statuses: array<string, int>, quoted: BigDecimal, converted: BigDecimal, days: int, name: string}  $g
     * @return array<string, string|int|null>
     */
    private static function figures(array $g): array
    {
        $s = $g['statuses'];
        $converted = $s[QuoteStatus::Converted->value] ?? 0;

        return [
            'quote_count' => $g['count'],
            'open_count' => $s[QuoteStatus::Sent->value] ?? 0,
            'accepted_count' => $s[QuoteStatus::Accepted->value] ?? 0,
            'converted_count' => $converted,
            'rejected_count' => $s[QuoteStatus::Rejected->value] ?? 0,
            'expired_count' => $s[QuoteStatus::Expired->value] ?? 0,
            'cancelled_count' => $s[QuoteStatus::Cancelled->value] ?? 0,
            'quoted_value' => Num::money($g['quoted']),
            'converted_value' => Num::money($g['converted']),
            'conversion_rate_percent' => Num::percent(BigDecimal::of($converted), BigDecimal::of($g['count'])),
            'value_conversion_rate_percent' => Num::percent($g['converted'], $g['quoted']),
            'average_days_to_convert' => $converted === 0 ? null : (string) BigDecimal::of($g['days'])->dividedBy($converted, 1, RoundingMode::HalfUp),
        ];
    }
}
