<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Services\Reports;

use App\Modules\Inventory\Data\Reports\ReportFilters;
use App\Modules\Inventory\Data\Reports\ReportTable;
use Brick\Math\BigDecimal;

/**
 * Stock status as of a date: quantity, average cost and value reconstructed from the movements dated
 * on or before as_of, per item x warehouse (default), item, warehouse or category. Quantity and
 * average are only meaningful per item, so warehouse and category rows carry item_count and value
 * (quantity and avg_cost null). Rows with zero quantity and value are left out unless include_zero.
 */
final class StockStatusReport
{
    public const array IDENTITY = [
        'item_id', 'item_code', 'item_name', 'base_unit_id', 'warehouse_id', 'warehouse_code', 'warehouse_name',
        'category_id', 'category_code', 'category_name',
    ];

    public function __construct(
        private readonly ReportQuery $query,
        private readonly PairGroups $groups,
    ) {}

    public function build(ReportFilters $f, string $asOf, string $groupBy, bool $includeZero): ReportTable
    {
        $pairs = array_values($this->query->pairTotals($f, $asOf));

        return self::table($this->groups->group($f->companyId, $pairs, $groupBy, ['quantity', 'value']), $groupBy, $includeZero, [
            'as_of' => $asOf,
            'group_by' => $groupBy,
        ]);
    }

    /**
     * @param  list<array{identity: array<string, string|null>, item_count: int, figures: array<string, BigDecimal>, item_ids: list<string>}>  $groups
     * @param  array<string, mixed>  $meta
     */
    public static function table(array $groups, string $groupBy, bool $includeZero, array $meta): ReportTable
    {
        $perItem = in_array($groupBy, ['item_warehouse', 'item'], true);
        $rows = [];
        $total = BigDecimal::zero();

        foreach ($groups as $group) {
            $qty = $group['figures']['quantity'];
            $value = $group['figures']['value'];

            if (! $includeZero && $qty->isZero() && $value->isZero()) {
                continue;
            }

            $total = $total->plus($value);
            $rows[] = [
                ...$group['identity'],
                'item_count' => $group['item_count'],
                'quantity' => $perItem ? ReportQuery::qty($qty) : null,
                'avg_cost' => $perItem ? ReportQuery::average($value, $qty) : null,
                'value' => ReportQuery::money($value),
            ];
        }

        return new ReportTable($rows, [...self::IDENTITY, 'item_count', 'quantity', 'avg_cost', 'value'], [
            ...$meta,
            'totals' => ['value' => ReportQuery::money($total)],
        ]);
    }
}
