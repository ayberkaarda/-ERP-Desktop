<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Services\Reports;

use App\Modules\Inventory\Data\Reports\ReportFilters;
use App\Modules\Inventory\Data\Reports\ReportTable;
use Brick\Math\BigDecimal;

/**
 * ABC analysis per item. basis=consumption (default): net value issued in the range (issues and
 * production use less their reversals); basis=stock_value: stock value as of date_to. Items with a
 * positive value are ranked by value (descending, then code); share = value / total x 100 and
 * cumulative_share runs down the ranking. Class A while the cumulative share before the item is
 * below `a` (default 80), B while below `b` (default 95), C otherwise: the item that crosses a limit
 * still belongs to the higher class, and the first item is always A. Classes are decided on exact
 * values; share and cumulative_share are rounded (scale 4) for output only.
 */
final class AbcAnalysisReport
{
    public const array COLUMNS = ['rank', 'class', 'item_id', 'item_code', 'item_name', 'base_unit_id', 'category_id', 'quantity', 'value', 'share', 'cumulative_share'];

    public function __construct(private readonly ReportQuery $query) {}

    public function build(ReportFilters $f, string $from, string $to, string $basis, BigDecimal $a, BigDecimal $b): ReportTable
    {
        $pairs = $basis === 'stock_value' ? $this->query->pairTotals($f, $to) : $this->query->consumption($f, $from, $to);
        $byItem = [];

        foreach ($pairs as $pair) {
            $id = $pair['item_id'];
            $byItem[$id] ??= ['quantity' => BigDecimal::zero(), 'value' => BigDecimal::zero()];
            $byItem[$id]['quantity'] = $byItem[$id]['quantity']->plus($pair['quantity']);
            $byItem[$id]['value'] = $byItem[$id]['value']->plus($pair['value']);
        }

        $byItem = array_filter($byItem, static fn (array $i): bool => $i['value']->isPositive());
        $items = $this->query->items($f->companyId, array_map('strval', array_keys($byItem)));
        $total = BigDecimal::zero();

        foreach ($byItem as $figures) {
            $total = $total->plus($figures['value']);
        }

        $ranked = [];

        foreach ($byItem as $id => $figures) {
            $ranked[] = ['id' => (string) $id, 'code' => $items[(string) $id]['code'] ?? '', ...$figures];
        }

        usort($ranked, static fn (array $x, array $y): int => $y['value']->compareTo($x['value']) ?: strcmp($x['code'], $y['code']));
        $rows = [];
        $cumulative = BigDecimal::zero();
        $classes = ['A' => ['items' => 0, 'value' => BigDecimal::zero()], 'B' => ['items' => 0, 'value' => BigDecimal::zero()], 'C' => ['items' => 0, 'value' => BigDecimal::zero()]];

        foreach ($ranked as $i => $entry) {
            // Exact: cumulative / total x 100 < limit  <=>  cumulative x 100 < total x limit.
            $before = $cumulative->multipliedBy(100);
            $class = $before->isLessThan($total->multipliedBy($a)) ? 'A' : ($before->isLessThan($total->multipliedBy($b)) ? 'B' : 'C');
            $cumulative = $cumulative->plus($entry['value']);
            $classes[$class]['items']++;
            $classes[$class]['value'] = $classes[$class]['value']->plus($entry['value']);
            $item = $items[$entry['id']] ?? null;
            $rows[] = [
                'rank' => $i + 1,
                'class' => $class,
                'item_id' => $entry['id'],
                'item_code' => $item['code'] ?? null,
                'item_name' => $item['name'] ?? null,
                'base_unit_id' => $item['base_unit_id'] ?? null,
                'category_id' => $item['category_id'] ?? null,
                'quantity' => ReportQuery::qty($entry['quantity']),
                'value' => ReportQuery::money($entry['value']),
                'share' => (string) ReportQuery::percent($entry['value'], $total),
                'cumulative_share' => (string) ReportQuery::percent($cumulative, $total),
            ];
        }

        return new ReportTable($rows, self::COLUMNS, [
            'date_from' => $from,
            'date_to' => $to,
            'basis' => $basis,
            'thresholds' => ['a' => (string) $a, 'b' => (string) $b],
            'totals' => [
                'items' => count($rows),
                'value' => ReportQuery::money($total),
                'classes' => array_map(static fn (array $c): array => [
                    'items' => $c['items'], 'value' => ReportQuery::money($c['value']), 'share' => (string) ReportQuery::percent($c['value'], $total),
                ], $classes),
            ],
        ]);
    }
}
