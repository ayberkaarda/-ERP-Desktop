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

    public function findByCode(string $code): ?ItemData;

    public function findByBarcode(string $barcode): ?BarcodeMatch;

    /** The variant exists (not deleted) and belongs to the item. */
    public function variantBelongsTo(string $variantId, string $itemId): bool;
}
