<?php

declare(strict_types=1);

namespace App\Modules\Reference\Services;

use App\Modules\Reference\Models;
use Illuminate\Database\Eloquent\Model;

final class ReferenceSchema
{
    /** @var array<string, class-string<Model>> */
    public const array MODELS = [
        'currencies' => Models\Currency::class,
        'exchange-rates' => Models\ExchangeRate::class,
        'tax-codes' => Models\TaxCode::class,
        'payment-terms' => Models\PaymentTerm::class,
        'warehouses' => Models\Warehouse::class,
        'locations' => Models\Location::class,
        'cost-centers' => Models\CostCenter::class,
        'projects' => Models\Project::class,
    ];

    /** @return class-string<Model> */
    public static function model(string $resource): string
    {
        return self::MODELS[$resource];
    }

    /** @return array<string, list<string>> */
    public static function rules(string $resource): array
    {
        $common = ['code' => ['required', 'string', 'max:40'], 'name' => ['required', 'string', 'max:255'], 'is_active' => ['sometimes', 'boolean']];

        return match ($resource) {
            'currencies' => ['is_active' => ['required', 'boolean']],
            'exchange-rates' => [
                'currency_code' => ['required', 'string', 'regex:/^[A-Z]{3}$/'],
                'rate_date' => ['required', 'date_format:Y-m-d', 'before_or_equal:today'],
                'forex_buying' => ['required', 'string', 'numeric', 'regex:/^\d{1,14}(\.\d{1,6})?$/', 'gt:0'],
                'forex_selling' => ['required', 'string', 'numeric', 'regex:/^\d{1,14}(\.\d{1,6})?$/', 'gt:0'],
                'banknote_buying' => ['nullable', 'string', 'numeric', 'regex:/^\d{1,14}(\.\d{1,6})?$/', 'gt:0'],
                'banknote_selling' => ['nullable', 'string', 'numeric', 'regex:/^\d{1,14}(\.\d{1,6})?$/', 'gt:0'],
            ],
            'tax-codes' => $common + [
                'type' => ['required', 'in:vat,withholding,excise,exemption,other'],
                'rate' => ['nullable', 'string', 'numeric', 'regex:/^\d{1,3}(\.\d{1,4})?$/', 'between:0,100'],
                'numerator' => ['nullable', 'required_if:type,withholding', 'integer', 'min:1', 'max:65535', 'lte:denominator'],
                'denominator' => ['nullable', 'required_if:type,withholding', 'integer', 'min:1', 'max:65535'],
                'effective_from' => ['required', 'date_format:Y-m-d'],
                'effective_to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:effective_from'],
                'meta' => ['nullable', 'array'],
            ],
            'payment-terms' => $common + [
                'due_days' => ['required', 'integer', 'between:0,36500'],
                'discount_percent' => ['sometimes', 'string', 'numeric', 'regex:/^\d{1,3}(\.\d{1,4})?$/', 'between:0,100'],
                'discount_days' => ['sometimes', 'integer', 'min:0', 'lte:due_days'],
            ],
            'warehouses' => $common + [
                'branch_id' => ['nullable', 'uuid'],
                'address' => ['nullable', 'array'],
                'negative_stock_policy' => ['sometimes', 'in:allow,warn,block'],
                'is_default' => ['sometimes', 'boolean'],
            ],
            'locations' => $common + [
                'parent_id' => ['nullable', 'uuid'],
                'type' => ['required', 'in:aisle,rack,shelf,bin'],
                'barcode' => ['nullable', 'string', 'max:255'],
            ],
            'cost-centers' => $common + ['parent_id' => ['nullable', 'uuid']],
            'projects' => [
                'code' => $common['code'], 'name' => $common['name'],
                'status' => ['sometimes', 'in:planned,active,on_hold,closed'],
                'start_date' => ['nullable', 'date_format:Y-m-d'],
                'end_date' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:start_date'],
                'party_id' => ['nullable', 'uuid'],
                'cost_center_id' => ['nullable', 'uuid'],
            ],
            default => [],
        };
    }
}
