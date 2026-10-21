<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @property object $resource
 */
final class StockSerialResource extends JsonResource
{
    /** @return array{id: string, item_id: string, item_code: string|null, item_name: string|null, serial_no: string, lot_id: string|null, lot_no: string|null, status: string, warehouse_id: string|null, location_id: string|null, created_at: string|null, updated_at: string|null} */
    public function toArray(Request $request): array
    {
        $r = $this->resource;
        $text = static fn (string $key): ?string => isset($r->{$key}) && is_scalar($r->{$key}) ? (string) $r->{$key} : null;

        return [
            'id' => (string) $text('id'),
            'item_id' => (string) $text('item_id'),
            'item_code' => $text('item_code'),
            'item_name' => $text('item_name'),
            'serial_no' => (string) $text('serial_no'),
            'lot_id' => $text('lot_id'),
            'lot_no' => $text('lot_no'),
            'status' => (string) $text('status'),
            'warehouse_id' => $text('warehouse_id'),
            'location_id' => $text('location_id'),
            'created_at' => $text('created_at'),
            'updated_at' => $text('updated_at'),
        ];
    }
}
