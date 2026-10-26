<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Http\Requests;

use App\Modules\Accounting\Models\AccountDeterminationRule;

final class DeterminationTestRequest extends AccountingRequest
{
    protected function gate(): array
    {
        return ['test', AccountDeterminationRule::class];
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'event_key' => ['required', 'string', 'max:100', 'regex:/^[a-z0-9_]+(\.[a-z0-9_]+)*$/'],
            'context' => ['sometimes', 'array'],
            'context.*' => ['nullable', 'string', 'max:100'],
        ];
    }
}
