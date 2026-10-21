<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Http\Requests;

use App\Modules\Accounting\Models\FiscalYear;

final class FiscalYearRequest extends AccountingRequest
{
    protected function gate(): array
    {
        return [$this->creating() ? 'create' : 'update', FiscalYear::class];
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'code' => $this->creating() ? ['required', 'string', 'max:16', 'regex:/^[A-Za-z0-9._-]+$/'] : ['prohibited'],
            'name' => ['sometimes', 'nullable', 'string', 'max:200'],
            'start_date' => [$this->required(), 'date_format:Y-m-d'],
            'end_date' => ['sometimes', 'nullable', 'date_format:Y-m-d', 'after_or_equal:start_date'],
            'adjustment_period' => $this->creating() ? ['sometimes', 'boolean'] : ['prohibited'],
            'version' => $this->versionRule(),
        ];
    }
}
