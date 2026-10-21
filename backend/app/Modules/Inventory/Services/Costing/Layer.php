<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Services\Costing;

use Brick\Math\BigDecimal;

/**
 * A FIFO cost layer held in memory while a posting runs.
 */
final class Layer
{
    public bool $dirty = false;

    public function __construct(
        public readonly string $id,
        public readonly string $movementId,
        public readonly BigDecimal $originalQty,
        public BigDecimal $remainingQty,
        public BigDecimal $remainingValue,
        public readonly BigDecimal $unitCost,
        public readonly string $receivedAt,
        public readonly bool $isNew = false,
    ) {}
}
