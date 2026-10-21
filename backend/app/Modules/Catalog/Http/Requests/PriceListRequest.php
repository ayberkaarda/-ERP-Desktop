<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Http\Requests;

use App\Modules\Catalog\Models\PriceList;
use App\Modules\Catalog\Services\CatalogRules;
use App\Modules\Catalog\Services\ReferenceGuards;
use Illuminate\Validation\Validator;

final class PriceListRequest extends CatalogRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'code' => [$this->required(), 'string', 'max:32', 'regex:/^\S+$/', $this->unique('price_lists', 'code', $this->routeId('id'))],
            'name' => [$this->required(), 'string', 'max:200'],
            'currency_code' => [$this->required(), 'string', 'regex:/^[A-Z]{3}$/'],
            'is_default' => ['sometimes', 'boolean'],
            'valid_from' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'valid_to' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'is_active' => ['sometimes', 'boolean'],
            'tax_inclusive' => ['sometimes', 'boolean'],
            'version' => $this->versionRule(),
        ];
    }

    /** @return list<\Closure(Validator): void> */
    public function after(): array
    {
        return [function (Validator $validator): void {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }

            $currency = $this->input('currency_code');

            if (is_string($currency) && ! app(ReferenceGuards::class)->currencyExists($currency)) {
                $validator->errors()->add('currency_code', CatalogRules::message('currency_missing'));
            }

            $current = $this->creating() ? null : PriceList::query()->find($this->routeId('id'));

            // Unknown record: the controller answers 404 before anything is written.
            if (! $this->creating() && $current === null) {
                return;
            }

            $from = $this->input('valid_from', $current?->valid_from?->toDateString());
            $to = $this->input('valid_to', $current?->valid_to?->toDateString());

            if (is_string($from) && is_string($to) && $to < $from) {
                $validator->errors()->add('valid_to', CatalogRules::message('invalid_validity'));
            }
        }];
    }
}
