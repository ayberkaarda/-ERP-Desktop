<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Resources;

use App\Modules\Inventory\Support\Stock;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A lot with its stock on hand (all warehouses) and expiry state relative to today.
 *
 * @property object $resource
 */
final class StockLotResource extends JsonResource
{
    /** @return array{id: string, item_id: string, item_code: string|null, item_name: string|null, lot_no: string, expiry_date: string|null, manufacture_date: string|null, on_hand: string, is_expired: bool, created_at: string|null} */
    public function toArray(Request $request): array
    {
        $r = $this->resource;
        $text = static fn (string $key): ?string => isset($r->{$key}) && is_scalar($r->{$key}) ? (string) $r->{$key} : null;
        $expiry = $text('expiry_date');

        return [
            'id' => (string) $text('id'),
            'item_id' => (string) $text('item_id'),
            'item_code' => $text('item_code'),
            'item_name' => $text('item_name'),
            'lot_no' => (string) $text('lot_no'),
            'expiry_date' => $expiry,
            'manufacture_date' => $text('manufacture_date'),
            'on_hand' => Stock::qty($text('on_hand') ?? '0'),
            'is_expired' => $expiry !== null && $expiry < now()->format('Y-m-d'),
            'created_at' => $text('created_at'),
        ];
    }
}
