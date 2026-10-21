<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Http\Requests;

use App\Modules\Accounting\Models\FiscalYear;

/**
 * POST /fiscal-years/{id}/close and /reopen; reopening needs a reason.
 */
final class FiscalYearStatusRequest extends AccountingRequest
{
    protected function gate(): array
    {
        return [$this->reopening() ? 'reopen' : 'close', FiscalYear::class];
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
