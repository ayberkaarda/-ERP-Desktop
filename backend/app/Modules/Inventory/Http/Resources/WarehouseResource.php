<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Resources;

use App\Modules\Inventory\Data\WarehouseData;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A Reference warehouse with its inventory policy; version is the policy row's version.
 *
 * @property WarehouseData $resource
 */
final class WarehouseResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $w = $this->resource;

        return [
            'id' => $w->id,
            'code' => $w->code,
            'name' => $w->name,
            'is_active' => $w->isActive,
            'is_default' => $w->isDefault,
            'negative_stock_policy' => $w->negativeStockPolicy,
            'allow_negative_stock' => $w->allowNegativeStock,
            'reservation_policy' => $w->reservationPolicy->value,
            'version' => $w->settingsVersion,
        ];
    }
}
