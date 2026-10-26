<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Requests;

use App\Modules\Inventory\Models\StockDocument;

final class ReverseDocumentRequest extends InventoryRequest
{
    protected function gate(): array
    {
        return ['reverse', StockDocument::class];
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'date' => ['required', 'date_format:Y-m-d'],
            'reason' => ['required', 'string', 'max:1000'],
            'version' => ['sometimes', 'integer', 'min:1'],
        ];
    }
}
