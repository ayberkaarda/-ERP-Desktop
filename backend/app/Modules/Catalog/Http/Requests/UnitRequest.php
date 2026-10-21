<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Http\Requests;

final class UnitRequest extends CatalogRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'code' => [$this->required(), 'string', 'max:32', 'regex:/^\S+$/', $this->unique('units', 'code', $this->routeId('id'))],
            'name' => [$this->required(), 'string', 'max:200'],
            'symbol' => ['sometimes', 'nullable', 'string', 'max:16'],
            'is_active' => ['sometimes', 'boolean'],
            'version' => $this->versionRule(),
        ];
    }
}
