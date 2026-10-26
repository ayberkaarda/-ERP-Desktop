<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Http\Resources;

use App\Modules\Catalog\Models\UnitConversion;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin UnitConversion
 */
final class UnitConversionResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'from_unit_id' => $this->from_unit_id,
            'to_unit_id' => $this->to_unit_id,
            'factor' => (string) $this->factor,
            'from_unit' => $this->whenLoaded('fromUnit', fn () => $this->fromUnit === null ? null : ['id' => $this->fromUnit->id, 'code' => $this->fromUnit->code]),
            'to_unit' => $this->whenLoaded('toUnit', fn () => $this->toUnit === null ? null : ['id' => $this->toUnit->id, 'code' => $this->toUnit->code]),
            'version' => $this->version,
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
