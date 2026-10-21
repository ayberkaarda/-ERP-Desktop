<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Requests;

use App\Modules\Inventory\Models\StockReservation;

final class ReleaseReservationRequest extends InventoryRequest
{
    protected function gate(): array
    {
        return ['release', StockReservation::class];
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return ['version' => ['sometimes', 'integer', 'min:1']];
    }
}
