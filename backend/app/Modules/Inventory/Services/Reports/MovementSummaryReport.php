<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Services\Reports;

use App\Modules\Inventory\Data\Reports\ReportFilters;
use App\Modules\Inventory\Data\Reports\ReportTable;
use App\Modules\Inventory\Support\Stock;
use Brick\Math\BigDecimal;

/**
 * Movement summary over a range per item x warehouse (default), item, warehouse or category:
 * opening (before date_from), inbound and outbound in the range (by direction, reversals included
 * on the side they move) and closing, as quantity and value; closing = opening + in - out.
 * meta.by_type: movement count and value per movement type and direction in the range.
 */
final class MovementSummaryReport
{
    private const array FIELDS = ['opening_quantity', 'opening_value', 'in_quantity', 'in_value', 'out_quantity', 'out_value', 'closing_quantity', 'closing_value'];

    public function __construct(
        private readonly ReportQuery $query,
        private readonly PairGroups $groups,
    ) {}

    public function build(ReportFilters $f, string $from, string $to, string $groupBy, bool $includeZero): ReportTable
    {
        $pairs = [];
        $blank = array_fill_keys(self::FIELDS, BigDecimal::zero());

        foreach ($this->query->pairTotals($f, $from, inclusive: false) as $key => $t) {
            $pairs[$key] = ['item_id' => $t['item_id'], 'warehouse_id' => $t['warehouse_id'], ...$blank, 'opening_quantity' => $t['quantity'], 'opening_value' => $t['value']];
        }

        $range = $this->query->movements($f)->whereBetween('m.occurred_at', [$from, $to])
            ->groupBy('m.item_id', 'm.warehouse_id')
            ->selectRaw("m.item_id, m.warehouse_id,
                coalesce(sum(CASE WHEN m.direction = 'in' THEN m.quantity END), 0) as in_quantity, coalesce(sum(CASE WHEN m.direction = 'in' THEN m.total_cost END), 0) as in_value,
                coalesce(sum(CASE WHEN m.direction = 'out' THEN m.quantity END), 0) as out_quantity, coalesce(sum(CASE WHEN m.direction = 'out' THEN m.total_cost END), 0) as out_value")
            ->get();

        foreach ($range as $r) {
            $key = $r->item_id.'|'.$r->warehouse_id;
            $pairs[$key] ??= ['item_id' => (string) $r->item_id, 'warehouse_id' => (string) $r->warehouse_id, ...$blank];

            foreach (['in_quantity', 'in_value', 'out_quantity', 'out_value'] as $field) {
                $pairs[$key][$field] = Stock::dec((string) $r->{$field});
            }
        }

        foreach ($pairs as $key => $p) {
            $pairs[$key]['closing_quantity'] = $p['opening_quantity']->plus($p['in_quantity'])->minus($p['out_quantity']);
            $pairs[$key]['closing_value'] = $p['opening_value']->plus($p['in_value'])->minus($p['out_value']);
        }

        $perItem = in_array($groupBy, ['item', 'item_warehouse'], true);
        $sum = array_fill_keys(['opening_value', 'in_value', 'out_value', 'closing_value'], BigDecimal::zero());
        $rows = [];

        foreach ($this->groups->group($f->companyId, array_values($pairs), $groupBy, self::FIELDS) as $group) {
            $g = $group['figures'];
            $empty = true;

            foreach (self::FIELDS as $field) {
                $empty = $empty && $g[$field]->isZero();
            }

            if ($empty && ! $includeZero) {
                continue;
            }

            $row = [...$group['identity'], 'item_count' => $group['item_count']];

            foreach (self::FIELDS as $field) {
                $isValue = str_ends_with($field, '_value');
                $row[$field] = $isValue ? ReportQuery::money($g[$field]) : ($perItem ? ReportQuery::qty($g[$field]) : null);

                if (isset($sum[$field])) {
                    $sum[$field] = $sum[$field]->plus($g[$field]);
                }
            }

            $rows[] = $row;
        }

        $byType = $this->query->movements($f)->whereBetween('m.occurred_at', [$from, $to])
            ->groupBy('m.movement_type', 'm.direction')->orderBy('m.movement_type')->orderBy('m.direction')
            ->selectRaw('m.movement_type, m.direction, count(*) as movements, sum(m.total_cost) as value')
            ->get();

        return new ReportTable($rows, [...StockStatusReport::IDENTITY, 'item_count', ...self::FIELDS], [
            'date_from' => $from,
            'date_to' => $to,
            'group_by' => $groupBy,
            'totals' => array_map(static fn (BigDecimal $v): string => ReportQuery::money($v), $sum),
            'by_type' => array_values(array_map(static fn ($t): array => [
                'movement_type' => (string) $t->movement_type, 'direction' => (string) $t->direction,
                'movements' => (int) $t->movements, 'value' => (string) Stock::money((string) $t->value),
            ], $byType->all())),
        ]);
    }
}
