<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Requests;

use App\Modules\Inventory\Models\StockDocument;

final class ImportLinesRequest extends InventoryRequest
{
    protected function gate(): array
    {
        return ['update', StockDocument::class];
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'file' => ['required', 'file', 'max:5120', 'extensions:csv,txt'],
            'dry_run' => ['sometimes', 'boolean'],
            'version' => ['sometimes', 'integer', 'min:1'],
        ];
    }
}
