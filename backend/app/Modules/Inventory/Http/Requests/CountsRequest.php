<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Requests;

use App\Modules\Inventory\Models\StockDocument;

/**
 * Counted quantities of a count document (null = not counted) and lines for stock found outside
 * the snapshot.
 */
final class CountsRequest extends InventoryRequest
{
    protected function gate(): array
    {
        return ['update', StockDocument::class];
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $qty = ['sometimes', 'nullable', 'string', 'regex:'.self::QTY];

        return [
            'version' => ['required', 'integer', 'min:1'],
            'counts' => ['sometimes', 'array', 'max:'.StockDocument::MAX_LINES],
            'counts.*.line_id' => ['required', 'uuid'],
            'counts.*.counted_quantity' => ['present', 'nullable', 'string', 'regex:'.self::QTY],
            'add' => ['sometimes', 'array', 'max:'.StockDocument::MAX_LINES],
            'add.*.item_id' => ['required', 'uuid'],
            'add.*.unit_id' => ['sometimes', 'nullable', 'uuid'],
            'add.*.location_id' => ['sometimes', 'nullable', 'uuid'],
            'add.*.lot_no' => ['sometimes', 'nullable', 'string', 'max:64'],
            'add.*.expiry_date' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'add.*.unit_cost' => $qty,
            'add.*.counted_quantity' => $qty,
        ];
    }
}
