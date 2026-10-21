<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Events;

use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Available stock of an item (all warehouses) is at or below its reorder point.
 */
final class StockBelowReorderPoint implements ShouldDispatchAfterCommit
{
    use Dispatchable;

    public function __construct(
        public readonly string $companyId,
        public readonly string $itemId,
        public readonly string $available,
        public readonly string $reorderPoint,
        public readonly string $suggestedQuantity,
    ) {}
}
