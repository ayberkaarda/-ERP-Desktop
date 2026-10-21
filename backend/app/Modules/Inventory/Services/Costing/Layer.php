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

    /**
     * FIFO consumption order: receipt date, then creation order (CostBook loads the open layers of a
     * pair ORDER BY received_at, id, and ids are uuid v7). Returns where a layer received on
     * $receivedAt goes in a list already in that order: after every layer received on or before it.
     *
     * @param  list<self>  $layers
     */
    public static function insertionIndex(array $layers, string $receivedAt): int
    {
        $low = 0;
        $high = count($layers);

        // Most receipts are the newest: check the end first, then binary search.
        if ($high === 0 || strcmp($layers[$high - 1]->receivedAt, $receivedAt) <= 0) {
            return $high;
        }

        while ($low < $high) {
            $mid = intdiv($low + $high, 2);

            if (strcmp($layers[$mid]->receivedAt, $receivedAt) <= 0) {
                $low = $mid + 1;
            } else {
                $high = $mid;
            }
        }

        return $low;
    }
}
