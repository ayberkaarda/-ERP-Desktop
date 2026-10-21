<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Http\Requests;

use App\Modules\Accounting\Models\JournalEntry;

final class ReverseEntryRequest extends AccountingRequest
{
    protected function gate(): array
    {
        return ['reverse', JournalEntry::class];
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
