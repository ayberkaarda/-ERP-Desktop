<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Http\Resources;

use App\Modules\Catalog\Models\DiscountRule;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin DiscountRule
 */
final class DiscountRuleResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'code' => $this->code,
            'name' => $this->name,
            'scope' => $this->scope->value,
            'scope_ref' => $this->scope_ref,
            'party_id' => $this->party_id,
            'min_qty' => (string) $this->min_qty,
            'discount_percent' => (string) $this->discount_percent,
            'priority' => $this->priority,
            'stackable' => $this->stackable,
            'valid_from' => $this->valid_from?->toDateString(),
            'valid_to' => $this->valid_to?->toDateString(),
            'is_active' => $this->is_active,
            'version' => $this->version,
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
