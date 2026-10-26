<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Services\Reports;

use Brick\Math\BigDecimal;

/**
 * Rolls (item, warehouse) figures up to the requested grouping and names the groups with one bulk
 * lookup per kind: item_warehouse (default), item, warehouse or category (the item's own category).
 * Rows come back in code order (item, then warehouse; category rows by category code, items
 * without a category last).
 */
final class PairGroups
{
    public const array GROUPINGS = ['item_warehouse', 'item', 'warehouse', 'category'];

    public function __construct(private readonly ReportQuery $query) {}

    /**
     * @param  list<array<string, mixed>>  $pairs  each with item_id, warehouse_id and the BigDecimal $fields
     * @param  list<string>  $fields
     * @return list<array{identity: array<string, string|null>, item_count: int, figures: array<string, BigDecimal>, item_ids: list<string>}>
     */
    public function group(string $companyId, array $pairs, string $groupBy, array $fields): array
    {
        $itemIds = [];
        $warehouseIds = [];

        foreach ($pairs as $pair) {
            $itemIds[] = (string) $pair['item_id'];
            $warehouseIds[] = (string) $pair['warehouse_id'];
        }

        $items = $this->query->items($companyId, $itemIds);
        $warehouses = in_array($groupBy, ['item_warehouse', 'warehouse'], true) ? $this->query->warehouses($companyId, $warehouseIds) : [];
        $categories = $groupBy === 'category'
            ? $this->query->categories($companyId, array_values(array_filter(array_map(static fn (array $i): ?string => $i['category_id'], $items))))
            : [];
        $groups = [];

        foreach ($pairs as $pair) {
            $itemId = (string) $pair['item_id'];
            $warehouseId = (string) $pair['warehouse_id'];
            $item = $items[$itemId] ?? null;
            $categoryId = $item['category_id'] ?? null;

            $key = match ($groupBy) {
                'item' => $itemId,
                'warehouse' => $warehouseId,
                'category' => $categoryId ?? '-',
                default => $itemId.'|'.$warehouseId,
            };

            if (! isset($groups[$key])) {
                $identity = [
                    'item_id' => null, 'item_code' => null, 'item_name' => null, 'base_unit_id' => null,
                    'warehouse_id' => null, 'warehouse_code' => null, 'warehouse_name' => null,
                    'category_id' => null, 'category_code' => null, 'category_name' => null,
                ];

                if (in_array($groupBy, ['item_warehouse', 'item'], true)) {
                    $identity['item_id'] = $itemId;
                    $identity['item_code'] = $item['code'] ?? null;
                    $identity['item_name'] = $item['name'] ?? null;
                    $identity['base_unit_id'] = $item['base_unit_id'] ?? null;
                    $identity['category_id'] = $categoryId;
                }

                if (in_array($groupBy, ['item_warehouse', 'warehouse'], true)) {
                    $identity['warehouse_id'] = $warehouseId;
                    $identity['warehouse_code'] = $warehouses[$warehouseId]['code'] ?? null;
                    $identity['warehouse_name'] = $warehouses[$warehouseId]['name'] ?? null;
                }

                if ($groupBy === 'category') {
                    $identity['category_id'] = $categoryId;
                    $identity['category_code'] = $categoryId === null ? null : ($categories[$categoryId]['code'] ?? null);
                    $identity['category_name'] = $categoryId === null ? null : ($categories[$categoryId]['name'] ?? null);
                }

                $groups[$key] = ['identity' => $identity, 'figures' => array_fill_keys($fields, BigDecimal::zero()), 'items' => []];
            }

            foreach ($fields as $field) {
                $value = $pair[$field] ?? null;
                $groups[$key]['figures'][$field] = $groups[$key]['figures'][$field]->plus($value instanceof BigDecimal ? $value : BigDecimal::zero());
            }

            $groups[$key]['items'][$itemId] = true;
        }

        $rows = array_map(static fn (array $g): array => [
            'identity' => $g['identity'],
            'item_count' => count($g['items']),
            'figures' => $g['figures'],
            'item_ids' => array_keys($g['items']),
        ], array_values($groups));

        $last = $groupBy === 'category';
        $order = static fn (array $i): array => [
            $last && $i['category_id'] === null ? '1' : '0', $last ? (string) $i['category_code'] : '',
            (string) $i['item_code'], (string) $i['warehouse_code'], (string) $i['item_id'], (string) $i['warehouse_id'],
        ];
        usort($rows, static fn (array $a, array $b): int => self::compare($order($a['identity']), $order($b['identity'])));

        return $rows;
    }

    /**
     * Byte-wise comparison of sort keys (codes like "010" must not compare as numbers).
     *
     * @param  list<string>  $a
     * @param  list<string>  $b
     */
    public static function compare(array $a, array $b): int
    {
        foreach ($a as $i => $value) {
            $c = strcmp($value, $b[$i] ?? '');

            if ($c !== 0) {
                return $c;
            }
        }

        return 0;
    }
}
