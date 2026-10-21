<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Http\Requests;

use App\Modules\Catalog\Models\Unit;
use App\Modules\Catalog\Models\UnitConversion;
use Brick\Math\BigDecimal;
use Illuminate\Validation\Validator;

/**
 * 1 from_unit = factor to_unit. The units of an existing conversion are immutable.
 */
final class UnitConversionRequest extends CatalogRequest
{
    protected function gate(): ?array
    {
        return $this->creating() ? ['create', Unit::class] : $this->recordGate(UnitConversion::class);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $creating = $this->creating();

        return [
            'from_unit_id' => $creating ? ['required', 'uuid', $this->existing('units')] : ['prohibited'],
            'to_unit_id' => $creating ? ['required', 'uuid', 'different:from_unit_id', $this->existing('units')] : ['prohibited'],
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
