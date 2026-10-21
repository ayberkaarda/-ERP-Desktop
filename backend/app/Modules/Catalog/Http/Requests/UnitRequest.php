<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Http\Requests;

use App\Modules\Catalog\Models\Unit;

/**
 * @ignoreSchema POST and PATCH validate differently; the API document keeps one request body per operation.
 */
final class UnitRequest extends CatalogRequest
{
    protected function gate(): array
    {
        return $this->recordGate(Unit::class);
    }

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
