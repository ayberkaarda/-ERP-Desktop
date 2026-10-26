<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Http\Requests;

use App\Modules\Accounting\Models\AccountingPeriod;

/**
 * POST /accounting-periods/{id}/soft-close|close|reopen; reopening needs its own permission and a reason.
 */
final class PeriodStatusRequest extends AccountingRequest
{
    protected function gate(): array
    {
        return [$this->reopening() ? 'reopen' : 'close', AccountingPeriod::class];
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'reason' => $this->reopening() ? ['required', 'string', 'max:1000'] : ['sometimes', 'nullable', 'string', 'max:1000'],
            'version' => ['sometimes', 'integer', 'min:1'],
        ];
    }

    public function reopening(): bool
    {
        return str_ends_with($this->path(), '/reopen');
    }
}
