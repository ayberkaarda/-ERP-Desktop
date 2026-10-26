<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Http\Requests;

use App\Modules\Accounting\Models\JournalEntry;

final class FxRevaluationRequest extends AccountingRequest
{
    protected function gate(): array
    {
        return ['revalue', JournalEntry::class];
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'period_id' => ['required', 'uuid'],
            'rate_date' => ['required', 'date_format:Y-m-d'],
            'dry_run' => ['sometimes', 'boolean'],
        ];
    }
}
