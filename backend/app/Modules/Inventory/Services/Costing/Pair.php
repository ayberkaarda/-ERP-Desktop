<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Services\Costing;

use Brick\Math\BigDecimal;

/**
 * Valuation state of one item in one warehouse while a posting runs: quantity, value, the moving
 * average and (FIFO) the open cost layers, oldest first.
 */
final class Pair
{
    /** @var list<Layer> */
    public array $layers = [];

    public bool $dirty = false;

    public function __construct(
        public readonly string $itemId,
        public readonly string $warehouseId,
        public BigDecimal $quantity,
        public BigDecimal $value,
        public BigDecimal $avgCost,
    ) {}

    public static function key(string $itemId, string $warehouseId): string
    {
        return $itemId.'|'.$warehouseId;
    }

    public function layerOfMovement(string $movementId): ?Layer
    {
        foreach ($this->layers as $layer) {
            if ($layer->movementId === $movementId) {
                return $layer;
            }
        }

        return null;
    }

    public function layer(string $id): ?Layer
    {
        foreach ($this->layers as $layer) {
            if ($layer->id === $id) {
                return $layer;
            }
        }

        return null;
    }
}
