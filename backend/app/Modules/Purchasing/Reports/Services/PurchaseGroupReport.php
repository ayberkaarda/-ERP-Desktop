<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Reports\Services;

use App\Modules\Purchasing\Reports\Data\PurchaseFact;
use App\Modules\Purchasing\Reports\Data\ReportFilters;
use App\Modules\Purchasing\Reports\Data\ReportTable;
use App\Modules\Purchasing\Reports\Support\Num;
use Brick\Math\BigDecimal;

/**
 * Net purchases grouped by supplier or item, largest net first, with the share of the report's net
 * (null when that is zero). Supplier names are the snapshot of the latest invoice in the range;
 * codes and item names are filled for the returned rows only (see ItemDirectory).
 * Top suppliers: the first `limit` suppliers with their cumulative share and the rest in meta.others.
 */
final class PurchaseGroupReport
{
    public const array SUPPLIER_COLUMNS = ['party_id', 'party_code', 'party_name', ...PurchaseBucket::AMOUNT_COLUMNS, 'share_percent'];

    public const array ITEM_COLUMNS = ['item_id', 'item_code', 'item_name', 'item_type', 'category_id', ...PurchaseBucket::QUANTITY_COLUMNS,
        ...PurchaseBucket::AMOUNT_COLUMNS, 'share_percent'];

    public const array TOP_COLUMNS = ['rank', 'party_id', 'party_code', 'party_name', 'invoice_count', 'purchases_amount', 'returns_amount',
        'net_amount', 'share_percent', 'cumulative_share_percent'];

    public function __construct(
        private readonly PurchaseFacts $facts,
        private readonly ItemDirectory $items,
    ) {}

    public function build(ReportFilters $f, string $by): ReportTable
    {
        [$rows, $totals] = $this->grouped($f, $by);

        return new ReportTable($rows, $by === 'supplier' ? self::SUPPLIER_COLUMNS : self::ITEM_COLUMNS, $totals->meta());
    }

    public function top(ReportFilters $f, int $limit): ReportTable
    {
        [$rows, $totals] = $this->grouped($f, 'supplier');
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
                'invoice_count' => $row['invoice_count'], 'purchases_amount' => $row['purchases_amount'], 'returns_amount' => $row['returns_amount'],
                'net_amount' => $row['net_amount'], 'share_percent' => $row['share_percent'], 'cumulative_share_percent' => Num::percent($cumulative, $net),
            ];
        }

        return new ReportTable($this->items->withParties($top), self::TOP_COLUMNS, [
            'limit' => $limit,
            ...$totals->meta(),
            'others' => ['supplier_count' => $othersCount, 'net_amount' => Num::money($othersNet), 'share_percent' => Num::percent($othersNet, $net)],
        ]);
    }

    /**
     * @return array{0: list<array<string, string|int|null>>, 1: PurchaseTotals}
     */
    private function grouped(ReportFilters $f, string $by): array
    {
        /** @var array<string, PurchaseBucket> $buckets */
        $buckets = [];
        $types = [];
        $totals = new PurchaseTotals;

        $this->facts->each($f, function (PurchaseFact $fact) use (&$buckets, &$types, $totals, $by): void {
            $key = $by === 'supplier' ? $fact->partyId : $fact->itemId;
            ($buckets[$key] ??= new PurchaseBucket)->add($fact);
            $types[$key] ??= $fact->itemType;
            $totals->add($fact);
        });

        $net = $totals->total->net();
        $rows = [];

        foreach ($buckets as $key => $bucket) {
            $key = (string) $key;
            $share = ['share_percent' => Num::percent($bucket->net(), $net)];
            $rows[] = $by === 'supplier'
                ? ['party_id' => $key, 'party_code' => null, 'party_name' => $bucket->label, ...$bucket->amounts(), ...$share]
                : ['item_id' => $key, 'item_code' => null, 'item_name' => null, 'item_type' => $types[$key], 'category_id' => null,
                    ...$bucket->quantities(), ...$bucket->amounts(), ...$share];
        }

        return [self::sortBy($rows, 'net_amount'), $totals];
    }

    /**
     * Largest value first; ties by the first column (the group id) for a stable order.
     *
     * @param  list<array<string, string|int|null>>  $rows
     * @return list<array<string, string|int|null>>
     */
    public static function sortBy(array $rows, string $column): array
    {
        usort($rows, static function (array $a, array $b) use ($column): int {
            $cmp = Num::dec($b[$column])->compareTo(Num::dec($a[$column]));

            return $cmp !== 0 ? $cmp : strcmp((string) reset($a), (string) reset($b));
        });

        return $rows;
    }
}
