<?php

declare(strict_types=1);

namespace App\Modules\Sales\Reports\Services;

use App\Modules\Catalog\Contracts\ItemLookup;
use App\Modules\Parties\Contracts\PartyLookup;

/**
 * Item and customer details through the Catalog and Parties contracts, memoized per request.
 * Parties come in one query per call; ItemLookup has no bulk read, so each distinct item costs one
 * lookup: reports ask only for the items of the rows they return (a page), or for every distinct
 * item when grouping or filtering by category. Deleted or foreign items resolve to null.
 */
final class ItemDirectory
{
    /** @var array<string, array{code: string, name: string, category_id: string|null}|null> */
    private array $items = [];

    public function __construct(
        private readonly ItemLookup $lookup,
        private readonly PartyLookup $parties,
    ) {}

    /** @return array{code: string, name: string, category_id: string|null}|null */
    public function item(string $itemId): ?array
    {
        if (! array_key_exists($itemId, $this->items)) {
            $item = $this->lookup->find($itemId);
            $this->items[$itemId] = $item === null ? null : ['code' => $item->code, 'name' => $item->name, 'category_id' => $item->categoryId];
        }

        return $this->items[$itemId];
    }

    public function categoryOf(string $itemId): ?string
    {
        return $this->item($itemId)['category_id'] ?? null;
    }

    /**
     * Customer codes by id (one query).
     *
     * @param  list<string>  $ids
     * @return array<string, string>
     */
    public function partyCodes(array $ids): array
    {
        $codes = [];

        foreach ($ids === [] ? [] : $this->parties->findMany(array_values(array_unique($ids))) as $id => $party) {
            $codes[$id] = $party->code;
        }

        return $codes;
    }

    /**
     * Adds item_code/item_name (and category_id when absent) to rows that carry an item_id.
     *
     * @param  list<array<string, string|int|null>>  $rows
     * @return list<array<string, string|int|null>>
     */
    public function withItems(array $rows): array
    {
        foreach ($rows as $i => $row) {
            $id = $row['item_id'] ?? null;
            $item = is_string($id) ? $this->item($id) : null;
            $rows[$i]['item_code'] = $item['code'] ?? null;
            $rows[$i]['item_name'] = $item['name'] ?? null;

            if (array_key_exists('category_id', $row) && $row['category_id'] === null) {
                $rows[$i]['category_id'] = $item['category_id'] ?? null;
            }
        }

        return $rows;
    }

    /**
     * Adds party_code to rows that carry a party_id.
     *
     * @param  list<array<string, string|int|null>>  $rows
     * @return list<array<string, string|int|null>>
     */
    public function withParties(array $rows): array
    {
        $ids = [];

        foreach ($rows as $row) {
            if (is_string($row['party_id'] ?? null)) {
                $ids[] = $row['party_id'];
            }
        }

        $codes = $this->partyCodes($ids);

        foreach ($rows as $i => $row) {
            $id = $row['party_id'] ?? null;
            $rows[$i]['party_code'] = is_string($id) ? ($codes[$id] ?? null) : null;
        }

        return $rows;
    }
}
