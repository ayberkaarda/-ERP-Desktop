<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Http\Requests;

use App\Modules\Accounting\Models\JournalEntry;

final class PostEntryRequest extends AccountingRequest
{
    protected function gate(): array
    {
        return ['post', JournalEntry::class];
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return ['version' => ['sometimes', 'integer', 'min:1']];
    }
}
