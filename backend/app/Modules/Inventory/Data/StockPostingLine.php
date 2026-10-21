<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Data;

/**
 * One line of a StockPostingRequest. The quantity is in the item's base unit (decimal string).
 * Serial items list their serial numbers (one per unit); lot items name the lot (an outbound line
 * without a lot is picked FEFO). $direction is used by adjustment documents only.
 */
final readonly class StockPostingLine
{
    /**
     * @param  list<string>  $serials
     */
    public function __construct(
        public string $itemId,
        public string $quantity,
        public ?string $unitCost = null,
        public ?string $lotNo = null,
        public ?string $expiry = null,
        public array $serials = [],
        public ?string $locationId = null,
        public ?string $targetLocationId = null,
        public ?string $direction = null,
        /** An active reservation this line consumes (released in the same transaction). */
        public ?string $reservationId = null,
        public ?string $unitId = null,
        public ?string $notes = null,
    ) {}
}
