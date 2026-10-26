<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Contracts;

use App\Modules\Catalog\Data\BarcodeMatch;
use App\Modules\Catalog\Data\ItemData;

/**
 * Read access to items of the active company (soft-deleted items are never returned).
 */
interface ItemLookup
{
    public function exists(string $itemId): bool;

    public function find(string $itemId): ?ItemData;

    /**
     * Items of the active company among the given ids, read in batches of at most 100 ids per
     * query; unknown, foreign, deleted or malformed ids are absent.
     *
     * @param  list<string>  $ids
     * @return array<string, ItemData> by id
     */
    public function findMany(array $ids): array;

    public function findByCode(string $code): ?ItemData;

    public function findByBarcode(string $barcode): ?BarcodeMatch;

    /** The variant exists (not deleted) and belongs to the item. */
    public function variantBelongsTo(string $variantId, string $itemId): bool;
}
