<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Data;

use App\Modules\Inventory\Models\StockReservation;

final readonly class ReservationData
{
    public function __construct(
        public string $id,
        public string $itemId,
        public string $warehouseId,
        public ?string $lotId,
        public string $quantity,
        public string $status,
        public ?string $sourceType,
        public ?string $sourceId,
        public ?string $expiresAt,
        /** Quantity reserved beyond what was available when it was made (soft policy), scale 6. */
        public string $shortage = '0.000000',
        public bool $replayed = false,
    ) {}

    public static function of(StockReservation $r, string $shortage = '0.000000', bool $replayed = false): self
    {
        return new self(
            $r->id, $r->item_id, $r->warehouse_id, $r->lot_id, (string) $r->quantity, $r->status->value,
            $r->source_type, $r->source_id, $r->expires_at?->toIso8601String(), $shortage, $replayed,
        );
    }
}
