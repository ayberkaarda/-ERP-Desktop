<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Services;

use App\Modules\Catalog\Contracts\ItemUsageChecker;
use Illuminate\Support\Facades\DB;

/**
 * An item with stock movements, document lines or reservations cannot be deleted.
 */
final class InventoryItemUsage implements ItemUsageChecker
{
    public function isUsed(string $itemId): bool
    {
        return DB::table('stock_movements')->where('item_id', $itemId)->exists()
            || DB::table('stock_document_lines')->where('item_id', $itemId)->exists()
            || DB::table('stock_reservations')->where('item_id', $itemId)->exists();
    }
}
