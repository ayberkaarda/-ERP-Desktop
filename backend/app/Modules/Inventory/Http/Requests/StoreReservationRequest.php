<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Requests;

use App\Modules\Inventory\Models\StockReservation;

final class StoreReservationRequest extends InventoryRequest
{
    protected function gate(): array
    {
        return ['create', StockReservation::class];
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'item_id' => ['required', 'uuid'],
            'warehouse_id' => ['required', 'uuid'],
            'lot_id' => ['sometimes', 'nullable', 'uuid'],
            'quantity' => ['required', 'string', 'regex:'.self::QTY],
            'source_type' => ['sometimes', 'nullable', 'string', 'max:64', 'required_with:source_id'],
            'source_id' => ['sometimes', 'nullable', 'uuid', 'required_with:source_type'],
            'expires_at' => ['sometimes', 'nullable', 'date'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:500'],
        ];
    }
}
