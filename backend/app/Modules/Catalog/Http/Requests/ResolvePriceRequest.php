<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Http\Requests;

/**
 * GET /pricing/resolve query: unit defaults to the base unit of the item, date to today (UTC).
 */
final class ResolvePriceRequest extends CatalogRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'item_id' => ['required', 'uuid'],
            'variant_id' => ['sometimes', 'nullable', 'uuid'],
            'party_id' => ['sometimes', 'nullable', 'uuid'],
            'qty' => ['sometimes', 'string', 'regex:'.self::DECIMAL],
            'unit_id' => ['sometimes', 'nullable', 'uuid'],
            'date' => ['sometimes', 'date_format:Y-m-d'],
            'currency' => ['required', 'string', 'regex:/^[A-Z]{3}$/'],
        ];
    }
}
