<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Http\Requests;

use App\Modules\Catalog\Models\Item;

/**
 * @ignoreSchema POST and PATCH validate differently; the API document keeps one request body per operation.
 */
final class ItemVariantRequest extends CatalogRequest
{
    protected function gate(): array
    {
        return $this->parentGate(Item::class, 'item');
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            // "<item code>-NNN" when omitted.
            'sku' => ['sometimes', $this->creating() ? 'nullable' : 'required', 'string', 'max:64', 'regex:/^\S+$/', $this->unique('item_variants', 'sku', $this->routeId('id'))],
            'name' => ['sometimes', 'nullable', 'string', 'max:255'],
            'attributes' => ['sometimes', 'nullable', 'array', 'max:100'],
            'is_active' => ['sometimes', 'boolean'],
            'version' => $this->versionRule(),
        ];
    }
}
