<?php

declare(strict_types=1);

namespace App\Modules\Sales\Reports\Services;

use App\Modules\Sales\Reports\Data\ReportFilters;
use App\Modules\Sales\Reports\Data\ReportTable;
use App\Modules\Sales\Reports\Data\RevenueFact;
use App\Modules\Sales\Reports\Support\Num;
use Brick\Math\BigDecimal;

/**
 * Net sales grouped by customer, item or category, largest net first, with the share of the
 * report's net (null when that is zero). Customer names are the snapshot of the latest invoice in
 * the range; codes and item names are filled for the returned rows only (see ItemDirectory).
 * Top customers: the first `limit` customers with their cumulative share and the rest in meta.others.
 */
final class SalesGroupReport
{
    public const array CUSTOMER_COLUMNS = ['party_id', 'party_code', 'party_name', ...SalesBucket::AMOUNT_COLUMNS, 'share_percent'];

    public const array ITEM_COLUMNS = ['item_id', 'item_code', 'item_name', 'item_type', 'category_id', ...SalesBucket::QUANTITY_COLUMNS, ...SalesBucket::AMOUNT_COLUMNS, 'share_percent'];

    public const array CATEGORY_COLUMNS = ['category_id', 'item_count', ...SalesBucket::AMOUNT_COLUMNS, 'share_percent'];

    public const array TOP_COLUMNS = ['rank', 'party_id', 'party_code', 'party_name', 'invoice_count', 'sales_amount', 'returns_amount', 'net_amount', 'share_percent', 'cumulative_share_percent'];

    public function __construct(
        private readonly RevenueFacts $facts,
        private readonly ItemDirectory $items,
    ) {}

    public function build(ReportFilters $f, string $by): ReportTable
    {
        [$rows, $totals] = $this->grouped($f, $by);
        $columns = match ($by) {
            'customer' => self::CUSTOMER_COLUMNS,
            'item' => self::ITEM_COLUMNS,
            default => self::CATEGORY_COLUMNS,
        };

        return new ReportTable($rows, $columns, $totals->meta());
    }

    /**
     * Fills codes and names of the rows being returned.
     *
     * @param  list<array<string, string|int|null>>  $rows
     * @return list<array<string, string|int|null>>
     */
    public function decorate(array $rows, string $by): array
    {
        return match ($by) {
            'customer' => $this->items->withParties($rows),
            'item' => $this->items->withItems($rows),
            default => $rows,
        };
    }

    public function top(ReportFilters $f, int $limit): ReportTable
    {
        [$rows, $totals] = $this->grouped($f, 'customer');
        $net = $totals->total->net();
        $cumulative = BigDecimal::zero();
        $top = [];
        $othersCount = 0;
        $othersNet = BigDecimal::zero();

        foreach ($rows as $n => $row) {
            $rowNet = Num::dec($row['net_amount']);

            if ($n >= $limit) {
                $othersCount++;
                $othersNet = $othersNet->plus($rowNet);

                continue;
            }

            $cumulative = $cumulative->plus($rowNet);
            $top[] = [
                'rank' => $n + 1, 'party_id' => $row['party_id'], 'party_code' => null, 'party_name' => $row['party_name'],
                'invoice_count' => $row['invoice_count'], 'sales_amount' => $row['sales_amount'], 'returns_amount' => $row['returns_amount'],
                'net_amount' => $row['net_amount'], 'share_percent' => $row['share_percent'], 'cumulative_share_percent' => Num::percent($cumulative, $net),
            ];
        }

        return new ReportTable($this->items->withParties($top), self::TOP_COLUMNS, [
            'limit' => $limit,
            ...$totals->meta(),
            'others' => ['customer_count' => $othersCount, 'net_amount' => Num::money($othersNet), 'share_percent' => Num::percent($othersNet, $net)],
        ]);
    }

    /**
     * @return array{0: list<array<string, string|int|null>>, 1: RevenueTotals}
     */
    private function grouped(ReportFilters $f, string $by): array
    {
        if ($by === 'category') {
            $this->items->needCategories();
        }

        /** @var array<string, SalesBucket> $buckets */
        $buckets = [];
        /** @var array<string, array{item_type: string, items: array<string, true>}> $extra */
        $extra = [];
        $totals = new RevenueTotals;

        $this->facts->each($f, function (RevenueFact $fact) use (&$buckets, &$extra, $totals, $by): void {
            $key = match ($by) {
                'customer' => $fact->partyId,
                'item' => $fact->itemId,
                default => $this->items->categoryOf($fact->itemId) ?? '',
            };
            ($buckets[$key] ??= new SalesBucket)->add($fact);
            $extra[$key] ??= ['item_type' => $fact->itemType, 'items' => []];
            $extra[$key]['items'][$fact->itemId] = true;
            $totals->add($fact);
        });

        $net = $totals->total->net();
        $rows = [];

        foreach ($buckets as $key => $bucket) {
            $key = (string) $key;
            $share = ['share_percent' => Num::percent($bucket->net(), $net)];
            $rows[] = match ($by) {
                'customer' => ['party_id' => $key, 'party_code' => null, 'party_name' => $bucket->label, ...$bucket->amounts(), ...$share],
                'item' => ['item_id' => $key, 'item_code' => null, 'item_name' => null, 'item_type' => $extra[$key]['item_type'],
                    'category_id' => null, ...$bucket->quantities(), ...$bucket->amounts(), ...$share],
                default => ['category_id' => $key === '' ? null : $key, 'item_count' => count($extra[$key]['items']), ...$bucket->amounts(), ...$share],
            };
        }

        return [self::sortByNet($rows), $totals];
    }

    /**
     * Largest net first; ties by the first column (the group id) for a stable order.
     *
     * @param  list<array<string, string|int|null>>  $rows
     * @return list<array<string, string|int|null>>
     */
    public static function sortByNet(array $rows, string $column = 'net_amount'): array
    {
        usort($rows, static function (array $a, array $b) use ($column): int {
            $cmp = Num::dec($b[$column])->compareTo(Num::dec($a[$column]));

            return $cmp !== 0 ? $cmp : strcmp((string) reset($a), (string) reset($b));
        });

        return $rows;
    }
}
