<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Services;

use App\Modules\Catalog\Contracts\ItemUsageChecker;
use App\Modules\Catalog\Models\DiscountRule;
use App\Modules\Catalog\Models\PriceListLine;

/**
 * In-module references: price list lines and item-scoped discount rules.
 */
final class PriceListItemUsage implements ItemUsageChecker
{
    public function isUsed(string $itemId): bool
    {
        return PriceListLine::query()->where('item_id', $itemId)->exists()
            || DiscountRule::query()->where('scope', 'item')->where('scope_ref', $itemId)->exists();
    }
}
