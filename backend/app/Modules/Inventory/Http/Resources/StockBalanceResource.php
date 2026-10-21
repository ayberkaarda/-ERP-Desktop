<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Resources;

use App\Modules\Inventory\Support\Stock;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One stock status row (item x warehouse, or finer by location/lot). Numbers are decimal strings;
 * value = on_hand x avg_cost of the warehouse.
 *
 * @property object $resource
 */
final class StockBalanceResource extends JsonResource
{
    /** @return array{item_id: string, item_code: string, item_name: string, base_unit_id: string, warehouse_id: string, warehouse_code: string|null, warehouse_name: string|null, location_id: string|null, location_code: string|null, lot_id: string|null, lot_no: string|null, expiry_date: string|null, on_hand: string, reserved: string, available: string, avg_cost: string, value: string} */
    public function toArray(Request $request): array
    {
        $r = $this->resource;
        $text = static fn (string $key): ?string => isset($r->{$key}) && is_scalar($r->{$key}) ? (string) $r->{$key} : null;

        return [
            'item_id' => (string) $text('item_id'),
            'item_code' => (string) $text('item_code'),
            'item_name' => (string) $text('item_name'),
            'base_unit_id' => (string) $text('base_unit_id'),
            'warehouse_id' => (string) $text('warehouse_id'),
            'warehouse_code' => $text('warehouse_code'),
            'warehouse_name' => $text('warehouse_name'),
            'location_id' => Stock::nullable($text('location_id')),
            'location_code' => $text('location_code'),
            'lot_id' => Stock::nullable($text('lot_id')),
            'lot_no' => $text('lot_no'),
            'expiry_date' => $text('expiry_date'),
            'on_hand' => Stock::qty($text('on_hand') ?? '0'),
            'reserved' => Stock::qty($text('reserved') ?? '0'),
            'available' => Stock::qty($text('available') ?? '0'),
            'avg_cost' => (string) Stock::dec($text('avg_cost') ?? '0')->toScale(6),
            'value' => (string) Stock::money($text('value') ?? '0'),
        ];
    }
}
