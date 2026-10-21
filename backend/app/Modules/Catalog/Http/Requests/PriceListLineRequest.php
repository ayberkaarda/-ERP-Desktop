<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Http\Requests;

use App\Modules\Catalog\Models\PriceListLine;
use App\Modules\Catalog\Services\PriceLineRules;
use App\Modules\Catalog\Services\UnitConverter;
use Illuminate\Validation\Validator;

final class PriceListLineRequest extends CatalogRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [...PriceLineRules::rules('', ! $this->creating()), 'version' => $this->versionRule()];
    }

    /** @return list<\Closure(Validator): void> */
    public function after(): array
    {
        return [function (Validator $validator): void {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }

            $current = $this->creating() ? null : PriceListLine::query()->find($this->routeId('id'));
            $line = [
                'item_id' => $current?->item_id,
                'variant_id' => $current?->variant_id,
                'unit_id' => $current?->unit_id,
                'valid_from' => $current?->valid_from?->toDateString(),
                'valid_to' => $current?->valid_to?->toDateString(),
                ...$this->only(['item_id', 'variant_id', 'unit_id', 'min_qty', 'price', 'valid_from', 'valid_to']),
            ];

            PriceLineRules::check($validator, [$line], static fn (): string => '', new UnitConverter);
        }];
    }
}
