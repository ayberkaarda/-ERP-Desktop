<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Requests\Reports;

/**
 * `as_of` (Y-m-d, default today): movements dated on or before it count.
 */
abstract class AsOfReportRequest extends InventoryReportRequest
{
    /** @return array<string, mixed> */
    protected function asOfRules(): array
    {
        return ['as_of' => ['sometimes', 'nullable', 'date_format:Y-m-d']];
    }

    public function asOf(): string
    {
        return $this->text('as_of') ?? $this->today();
    }
}
