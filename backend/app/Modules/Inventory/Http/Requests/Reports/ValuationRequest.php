<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Requests\Reports;

use App\Modules\Inventory\Enums\ValuationMethod;
use Illuminate\Validation\Rule;

/**
 * Stock status parameters plus `method` (moving_average | fifo; default the company's method).
 */
final class ValuationRequest extends StockStatusRequest
{
    /** @return array<string, mixed> */
    protected function reportRules(): array
    {
        return [
            ...parent::reportRules(),
            'method' => ['sometimes', 'nullable', Rule::in(ValuationMethod::values())],
        ];
    }

    public function valuationMethod(): ?ValuationMethod
    {
        return ValuationMethod::tryFrom($this->text('method') ?? '');
    }
}
