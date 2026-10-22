<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Reports\Services;

use App\Modules\Catalog\Contracts\ItemLookup;
use App\Modules\Parties\Contracts\PartyLookup;
use Generator;
use Illuminate\Support\LazyCollection;
use stdClass;

/**
 * Item and supplier details through the Catalog and Parties contracts, memoized per request (the
 * lookups themselves are resolved per call, in the active company). Items are read in bulk
 * (ItemLookup::findMany, batches of 100): the fact streams preload the items of each chunk when a
 * report needs categories, the decorators the items of the rows they return. Deleted or foreign
 * items resolve to null.
 */
final class ItemDirectory
{
    /** @var array<string, array{code: string, name: string, category_id: string|null}|null> */
    private array $items = [];

    private bool $categories = false;

    /** Reports grouping by category ask the fact streams to preload the items of every chunk. */
    public function needCategories(): void
    {
        $this->categories = true;
    }

    public function wantsCategories(): bool
    {
        return $this->categories;
    }

    /**
     * Loads the given items not yet known in one bulk read.
     *
     * @param  iterable<mixed>  $ids
     */
    public function preload(iterable $ids): void
    {
        $missing = [];

        foreach ($ids as $id) {
            if (is_string($id) && ! array_key_exists($id, $this->items)) {
                $missing[$id] = $id;
            }
        }

        if ($missing === []) {
            return;
        }

        $found = app(ItemLookup::class)->findMany(array_values($missing));

        foreach ($missing as $id) {
            $item = $found[$id] ?? null;
            $this->items[$id] = $item === null ? null : ['code' => $item->code, 'name' => $item->name, 'category_id' => $item->categoryId];
        }
    }

    /**
     * Passes the rows through, preloading the items of every 1 000 rows when $preload is set.
     *
     * @param  LazyCollection<int, stdClass>  $rows
     * @return Generator<int, stdClass>
     */
    public function stream(LazyCollection $rows, bool $preload): Generator
    {
        foreach ($rows->chunk(1000) as $chunk) {
            if ($preload) {
                $this->preload($chunk->pluck('item_id'));
            }

            foreach ($chunk as $row) {
                yield $row;
            }
        }
    }

    /** @return array{code: string, name: string, category_id: string|null}|null */
    public function item(string $itemId): ?array
    {
        if (! array_key_exists($itemId, $this->items)) {
            $this->preload([$itemId]);
        }

        return $this->items[$itemId] ?? null;
    }

    public function categoryOf(string $itemId): ?string
    {
        return $this->item($itemId)['category_id'] ?? null;
    }

    /**
     * Supplier codes by id.
     *
     * @param  list<string>  $ids
     * @return array<string, string>
     */
    public function partyCodes(array $ids): array
    {
        $codes = [];

        foreach ($this->parties($ids) as $id => $party) {
            $codes[$id] = $party['code'];
        }

        return $codes;
    }

    /**
     * Supplier codes and names by id, in batches of 100 (deleted or foreign parties are absent).
     *
     * @param  list<string>  $ids
     * @return array<string, array{code: string, name: string}>
     */
    public function parties(array $ids): array
    {
        $out = [];

        foreach (array_chunk(array_values(array_unique($ids)), 100) as $batch) {
            foreach (app(PartyLookup::class)->findMany($batch) as $id => $party) {
                $out[(string) $id] = ['code' => $party->code, 'name' => $party->name];
            }
        }

        return $out;
    }

    /**
     * Adds item_code/item_name (and category_id when absent) to rows that carry an item_id.
     *
     * @param  list<array<string, string|int|null>>  $rows
     * @return list<array<string, string|int|null>>
     */
    public function withItems(array $rows): array
    {
        $this->preload(array_column($rows, 'item_id'));

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
