<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Requests;

use App\Modules\Inventory\Enums\ReservationPolicy;
use App\Modules\Inventory\Models\WarehouseSetting;
use Illuminate\Validation\Rule;

final class WarehouseSettingRequest extends InventoryRequest
{
    protected function gate(): array
    {
        return ['update', WarehouseSetting::class];
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'reservation_policy' => ['required', Rule::in(ReservationPolicy::values())],
            'version' => ['required', 'integer', 'min:1'],
        ];
    }
}
