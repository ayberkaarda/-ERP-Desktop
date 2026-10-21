<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Http\Resources;

use App\Modules\Catalog\Models\Item;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Item
 */
final class ItemResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'code' => $this->code,
            'name' => $this->name,
            'description' => $this->description,
            'type' => $this->type->value,
            'base_unit_id' => $this->base_unit_id,
            'base_unit' => $this->whenLoaded('baseUnit', fn () => $this->baseUnit === null ? null : [
                'id' => $this->baseUnit->id, 'code' => $this->baseUnit->code, 'name' => $this->baseUnit->name, 'symbol' => $this->baseUnit->symbol,
            ]),
            'category_id' => $this->category_id,
            'category' => $this->whenLoaded('category', fn () => $this->category === null ? null : [
                'id' => $this->category->id, 'code' => $this->category->code, 'name' => $this->category->name,
            ]),
            'default_tax_code_id' => $this->default_tax_code_id,
            'purchase_tax_code_id' => $this->purchase_tax_code_id,
            'tracking' => $this->tracking->value,
            'has_expiry' => $this->has_expiry,
            'min_stock' => $this->min_stock === null ? null : (string) $this->min_stock,
            'reorder_point' => $this->reorder_point === null ? null : (string) $this->reorder_point,
            'is_active' => $this->is_active,
            'attributes' => $this->resource->getAttribute('attributes'),
            'units' => ItemUnitResource::collection($this->whenLoaded('units')),
            'version' => $this->version,
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
