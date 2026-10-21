<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Http\Requests;

use App\Modules\Catalog\Enums\ItemTracking;
use App\Modules\Catalog\Enums\ItemType;
use App\Modules\Catalog\Models\Item;
use App\Modules\Catalog\Services\CatalogRules;
use App\Modules\Catalog\Services\ReferenceGuards;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

final class ItemRequest extends CatalogRequest
{
    protected function gate(): array
    {
        return $this->recordGate(Item::class);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            // Generated from the `item` number sequence when omitted.
            'code' => ['sometimes', $this->creating() ? 'nullable' : 'required', 'string', 'max:64', 'regex:/^\S+$/', $this->unique('items', 'code', $this->routeId('id'))],
            'name' => [$this->required(), 'string', 'max:255'],
            'description' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'type' => [$this->required(), Rule::enum(ItemType::class)],
            'base_unit_id' => [$this->required(), 'uuid', $this->existing('units')],
            'category_id' => ['sometimes', 'nullable', 'uuid', $this->existing('item_categories')],
            'default_tax_code_id' => ['sometimes', 'nullable', 'uuid'],
            'purchase_tax_code_id' => ['sometimes', 'nullable', 'uuid'],
            'tracking' => ['sometimes', Rule::enum(ItemTracking::class)],
            'has_expiry' => ['sometimes', 'boolean'],
            'min_stock' => ['sometimes', 'nullable', 'string', 'regex:'.self::DECIMAL],
            'reorder_point' => ['sometimes', 'nullable', 'string', 'regex:'.self::DECIMAL],
            'is_active' => ['sometimes', 'boolean'],
            'attributes' => ['sometimes', 'nullable', 'array', 'max:100'],
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

            $guards = app(ReferenceGuards::class);

            foreach (['default_tax_code_id', 'purchase_tax_code_id'] as $field) {
                $id = $this->input($field);

                if (is_string($id) && ! $guards->taxCodeExists($id)) {
                    $validator->errors()->add($field, CatalogRules::message('tax_code_missing'));
                }
            }

            $current = $this->creating() ? null : Item::query()->find($this->routeId('id'));

            // Unknown record: the controller answers 404 before anything is written.
            if (! $this->creating() && $current === null) {
                return;
            }

            $type = $this->input('type', $current?->type->value);
            $tracking = $this->input('tracking', $current->tracking->value ?? ItemTracking::None->value);
            $expiry = $this->boolean('has_expiry', $current->has_expiry ?? false);

            // Services are never stocked, so they cannot be lot/serial tracked or expire.
            if ($type === ItemType::Service->value && ($tracking !== ItemTracking::None->value || $expiry)) {
                $validator->errors()->add('tracking', CatalogRules::message('service_tracking'));
            }
        }];
    }
}
