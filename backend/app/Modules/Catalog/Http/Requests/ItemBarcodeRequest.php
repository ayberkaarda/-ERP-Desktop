<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Http\Requests;

use App\Modules\Catalog\Enums\BarcodeType;
use App\Modules\Catalog\Models\Item;
use App\Modules\Catalog\Models\ItemBarcode;
use App\Modules\Catalog\Models\ItemUnit;
use App\Modules\Catalog\Models\ItemVariant;
use App\Modules\Catalog\Services\CatalogRules;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * The unit must be the base unit or an alternate unit of the item; the variant must belong to it.
 * Declared GTIN types (ean13, ean8, upca) must carry a valid check digit.
 */
final class ItemBarcodeRequest extends CatalogRequest
{
    protected function gate(): array
    {
        return $this->parentGate(Item::class, 'item');
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'barcode' => [$this->required(), 'string', 'max:64', 'regex:/^[\x21-\x7E]+$/', $this->unique('item_barcodes', 'barcode', $this->routeId('id'), false)],
            'type' => ['sometimes', Rule::enum(BarcodeType::class)],
            'unit_id' => ['sometimes', 'nullable', 'uuid'],
            'variant_id' => ['sometimes', 'nullable', 'uuid'],
            'is_primary' => ['sometimes', 'boolean'],
            'version' => $this->versionRule(),
        ];
    }

    /** @return list<\Closure(Validator): void> */
    public function after(): array
    {
        return [function (Validator $validator): void {
            $item = Item::query()->find($this->routeId('item'));

            if ($validator->errors()->isNotEmpty() || ! $item instanceof Item) {
                return;
            }

            $current = $this->creating() ? null : ItemBarcode::query()->find($this->routeId('id'));

            // Unknown record: the controller answers 404 before anything is written.
            if (! $this->creating() && $current === null) {
                return;
            }

            $barcode = $this->input('barcode', $current?->barcode);
            $type = BarcodeType::tryFrom((string) $this->input('type', $current->type->value ?? BarcodeType::Other->value));
            $checker = $type?->validator();

            if ($checker !== null && is_string($barcode) && ! $checker->isValid($barcode)) {
                $validator->errors()->add('barcode', CatalogRules::message('barcode_check_digit', ['type' => strtoupper($type->value)]));
            }

            $unit = $this->input('unit_id');

            if (is_string($unit) && $unit !== $item->base_unit_id
                && ! ItemUnit::query()->where('item_id', $item->id)->where('unit_id', $unit)->exists()) {
                $validator->errors()->add('unit_id', CatalogRules::message('barcode_unit'));
            }

            $variant = $this->input('variant_id');

            if (is_string($variant) && ! ItemVariant::query()->whereKey($variant)->where('item_id', $item->id)->exists()) {
                $validator->errors()->add('variant_id', CatalogRules::message('variant_mismatch'));
            }
        }];
    }
}
