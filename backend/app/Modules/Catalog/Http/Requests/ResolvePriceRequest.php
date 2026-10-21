<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Http\Requests;

use App\Modules\Catalog\Models\DiscountRule;
use App\Modules\Catalog\Services\CatalogRules;
use App\Modules\Catalog\Services\ReferenceGuards;
use Illuminate\Validation\Validator;

/**
 * GET /pricing/resolve query: unit defaults to the base unit of the item, date to today (UTC).
 * A party_id must name a party of the active company (checked through the Parties lookup).
 */
final class ResolvePriceRequest extends CatalogRequest
{
    protected function gate(): array
    {
        return ['resolve', DiscountRule::class];
    }

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

    /** @return list<\Closure(Validator): void> */
    public function after(): array
    {
        return [function (Validator $validator): void {
            $party = $this->input('party_id');

            if ($validator->errors()->isEmpty() && is_string($party) && ! app(ReferenceGuards::class)->partyExists($party)) {
                $validator->errors()->add('party_id', CatalogRules::message('party_missing'));
            }
        }];
    }
}
