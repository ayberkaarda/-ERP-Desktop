<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Resources;

use App\Modules\Inventory\Models\StockDocumentLine;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Quantities are decimal strings (scale 6); difference = counted - system for count lines.
 *
 * @mixin StockDocumentLine
 */
final class StockDocumentLineResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'line_no' => $this->line_no,
            'item_id' => $this->item_id,
            'unit_id' => $this->unit_id,
            'quantity' => (string) $this->quantity,
            'base_quantity' => (string) $this->base_quantity,
            'unit_cost' => $this->unit_cost?->__toString(),
            'lot_no' => $this->lot_no,
            'expiry_date' => $this->expiry_date?->format('Y-m-d'),
            'serial_numbers' => $this->serial_numbers,
            'location_id' => $this->location_id,
            'target_location_id' => $this->target_location_id,
            'direction' => $this->direction,
            'system_quantity' => $this->system_quantity?->__toString(),
            'counted_quantity' => $this->counted_quantity?->__toString(),
            // Count documents only: the current moving average of the item in the warehouse.
            'avg_cost' => $this->when($this->resource->getAttribute('avg_cost') !== null, fn (): string => (string) $this->resource->getAttribute('avg_cost')),
            'difference' => $this->counted_quantity === null ? null : (string) $this->counted_quantity->minus($this->system_quantity ?? '0'),
            'reservation_id' => $this->reservation_id,
            'notes' => $this->notes,
        ];
    }
}
