<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Data;

use DateTimeInterface;

/**
 * Holds stock of one item in one warehouse (optionally one lot) for a source document.
 * With a source the request is idempotent: an active reservation of the same source, item,
 * warehouse and lot is returned instead of a second one.
 */
final readonly class ReservationRequest
{
    public function __construct(
        public string $companyId,
        public string $itemId,
        public string $warehouseId,
        public string $quantity,
        public ?string $lotId = null,
        public ?string $sourceType = null,
        public ?string $sourceId = null,
        public ?DateTimeInterface $expiresAt = null,
        public ?string $createdBy = null,
        public ?string $notes = null,
    ) {}
}
