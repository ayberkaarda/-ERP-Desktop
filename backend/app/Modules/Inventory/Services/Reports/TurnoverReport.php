<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Services\Reports;

use App\Modules\Inventory\Data\Reports\ReportFilters;
use App\Modules\Inventory\Data\Reports\ReportTable;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use DateTimeImmutable;

/**
 * Stock turnover over a range, per item (default), item x warehouse, warehouse or category.
 * opening_value: stock value before date_from; closing_value: as of date_to;
 * average_value = (opening + closing) / 2; consumption_value: net value issued in the range (issues
 * and production use less their reversals); turnover = consumption / average (scale 4, null without
 * average stock); days_on_hand = days in range / turnover = average x days / consumption (scale 2,
 * null without consumption). Rows without any stock or consumption are left out.
 */
final class TurnoverReport
{
    public function __construct(
        private readonly ReportQuery $query,
        private readonly PairGroups $groups,
    ) {}

    public function build(ReportFilters $f, string $from, string $to, string $groupBy): ReportTable
    {
        $days = (int) (new DateTimeImmutable($from))->diff(new DateTimeImmutable($to))->format('%a') + 1;
        $pairs = [];
        $sources = [
            'opening' => $this->query->pairTotals($f, $from, inclusive: false),
            'closing' => $this->query->pairTotals($f, $to),
            'consumed' => $this->query->consumption($f, $from, $to),
        ];

        foreach ($sources as $name => $totals) {
            foreach ($totals as $key => $t) {
                $pairs[$key] ??= [
                    'item_id' => $t['item_id'], 'warehouse_id' => $t['warehouse_id'],
                    'opening_quantity' => BigDecimal::zero(), 'opening_value' => BigDecimal::zero(),
                    'closing_quantity' => BigDecimal::zero(), 'closing_value' => BigDecimal::zero(),
                    'consumed_quantity' => BigDecimal::zero(), 'consumed_value' => BigDecimal::zero(),
                ];
                $pairs[$key][$name.'_quantity'] = $t['quantity'];
                $pairs[$key][$name.'_value'] = $t['value'];
            }
        }

        $fields = ['opening_quantity', 'opening_value', 'closing_quantity', 'closing_value', 'consumed_quantity', 'consumed_value'];
        $perItem = in_array($groupBy, ['item', 'item_warehouse'], true);
        $sum = array_fill_keys(['opening_value', 'closing_value', 'consumed_value'], BigDecimal::zero());
        $rows = [];

        foreach ($this->groups->group($f->companyId, array_values($pairs), $groupBy, $fields) as $group) {
            $g = $group['figures'];

            if ($g['opening_value']->isZero() && $g['closing_value']->isZero() && $g['consumed_value']->isZero()
                && $g['opening_quantity']->isZero() && $g['closing_quantity']->isZero() && $g['consumed_quantity']->isZero()) {
                continue;
            }

            foreach (array_keys($sum) as $k) {
                $sum[$k] = $sum[$k]->plus($g[$k]);
            }

            $rows[] = [
                ...$group['identity'],
                'item_count' => $group['item_count'],
                'opening_quantity' => $perItem ? ReportQuery::qty($g['opening_quantity']) : null,
                'opening_value' => ReportQuery::money($g['opening_value']),
                'closing_quantity' => $perItem ? ReportQuery::qty($g['closing_quantity']) : null,
                'closing_value' => ReportQuery::money($g['closing_value']),
                'consumed_quantity' => $perItem ? ReportQuery::qty($g['consumed_quantity']) : null,
                ...self::ratios($g['opening_value'], $g['closing_value'], $g['consumed_value'], $days),
            ];
        }

        return new ReportTable($rows, [
            ...StockStatusReport::IDENTITY, 'item_count', 'opening_quantity', 'opening_value', 'closing_quantity', 'closing_value',
            'consumed_quantity', 'consumed_value', 'average_value', 'turnover', 'days_on_hand',
        ], [
            'date_from' => $from,
            'date_to' => $to,
            'days' => $days,
            'group_by' => $groupBy,
            'totals' => [
                'opening_value' => ReportQuery::money($sum['opening_value']),
                'closing_value' => ReportQuery::money($sum['closing_value']),
                ...self::ratios($sum['opening_value'], $sum['closing_value'], $sum['consumed_value'], $days),
            ],
        ]);
    }

    /**
     * @return array{consumed_value: string, average_value: string, turnover: string|null, days_on_hand: string|null}
     */
    public static function ratios(BigDecimal $opening, BigDecimal $closing, BigDecimal $consumed, int $days): array
    {
        $average = $opening->plus($closing)->dividedBy(2, 4, RoundingMode::HalfEven);

        return [
            'consumed_value' => ReportQuery::money($consumed),
            'average_value' => (string) $average,
            'turnover' => $average->isPositive() ? (string) $consumed->dividedBy($average, 4, RoundingMode::HalfEven) : null,
            'days_on_hand' => $consumed->isPositive() ? (string) $average->multipliedBy($days)->dividedBy($consumed, 2, RoundingMode::HalfEven) : null,
        ];
    }
}
