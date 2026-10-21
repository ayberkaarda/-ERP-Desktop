<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Http\Requests;

use App\Modules\Catalog\Models\Item;
use Brick\Math\BigDecimal;
use Illuminate\Validation\Validator;

/**
 * Alternate unit of an item: 1 unit_id = factor base units.
 */
final class ItemUnitRequest extends CatalogRequest
{
    protected function gate(): ?array
    {
        return $this->parentGate(Item::class, 'item');
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'unit_id' => $this->creating() ? ['required', 'uuid', $this->existing('units')] : ['prohibited'],
            'factor' => ['required', 'string', 'regex:'.self::DECIMAL],
            'version' => $this->versionRule(),
        ];
    }

    /** @return list<\Closure(Validator): void> */
    public function after(): array
    {
        return [function (Validator $validator): void {
            $factor = $this->input('factor');

            if (! $validator->errors()->has('factor') && is_string($factor) && BigDecimal::of($factor)->isZero()) {
                $validator->errors()->add('factor', (string) __('catalog::messages.factor_positive'));
            }
        }];
    }
}
