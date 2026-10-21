<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Http\Requests;

final class ItemVariantRequest extends CatalogRequest
{
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
