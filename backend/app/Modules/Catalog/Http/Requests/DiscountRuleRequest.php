<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Http\Requests;

use App\Modules\Catalog\Enums\DiscountScope;
use App\Modules\Catalog\Models\DiscountRule;
use App\Modules\Catalog\Models\Item;
use App\Modules\Catalog\Models\ItemCategory;
use App\Modules\Catalog\Services\CatalogRules;
use App\Modules\Catalog\Services\ReferenceGuards;
use Brick\Math\BigDecimal;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

final class DiscountRuleRequest extends CatalogRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'code' => [$this->required(), 'string', 'max:32', 'regex:/^\S+$/', $this->unique('discount_rules', 'code', $this->routeId('id'))],
            'name' => [$this->required(), 'string', 'max:200'],
            'scope' => [$this->required(), Rule::enum(DiscountScope::class)],
            'scope_ref' => ['sometimes', 'nullable', 'uuid'],
            'party_id' => ['sometimes', 'nullable', 'uuid'],
            'min_qty' => ['sometimes', 'string', 'regex:'.self::DECIMAL],
            'discount_percent' => [$this->required(), 'string', 'regex:/^\d{1,3}(\.\d{1,4})?$/'],
            'priority' => ['sometimes', 'integer', 'between:-1000000,1000000'],
            'stackable' => ['sometimes', 'boolean'],
            'valid_from' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'valid_to' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'is_active' => ['sometimes', 'boolean'],
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

            $current = $this->creating() ? null : DiscountRule::query()->find($this->routeId('id'));
            $scope = DiscountScope::from((string) $this->input('scope', $current?->scope->value));
            $ref = $this->input('scope_ref', $current?->scope_ref);
            $party = $this->input('party_id', $current?->party_id);
            $percent = $this->input('discount_percent');

            if (is_string($percent) && (BigDecimal::of($percent)->isZero() || BigDecimal::of($percent)->isGreaterThan(100))) {
                $validator->errors()->add('discount_percent', CatalogRules::message('discount_range'));
            }

            if ($scope->needsScopeRef()) {
                $exists = is_string($ref) && Str::isUuid($ref) && ($scope === DiscountScope::Item
                    ? Item::query()->whereKey($ref)->exists()
                    : ItemCategory::query()->whereKey($ref)->exists());

                if (! $exists) {
                    $validator->errors()->add('scope_ref', CatalogRules::message('scope_ref_missing'));
                }
            } elseif ($ref !== null) {
                $validator->errors()->add('scope_ref', CatalogRules::message('scope_ref_prohibited'));
            }

            if ($scope === DiscountScope::Party && $party === null) {
                $validator->errors()->add('party_id', CatalogRules::message('party_required'));
            }

            if (is_string($party) && ! app(ReferenceGuards::class)->partyExists($party)) {
                $validator->errors()->add('party_id', CatalogRules::message('party_missing'));
            }

            $from = $this->input('valid_from', $current?->valid_from?->toDateString());
            $to = $this->input('valid_to', $current?->valid_to?->toDateString());

            if (is_string($from) && is_string($to) && $to < $from) {
                $validator->errors()->add('valid_to', CatalogRules::message('invalid_validity'));
            }
        }];
    }
}
