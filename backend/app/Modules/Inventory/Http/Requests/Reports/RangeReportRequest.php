<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Requests\Reports;

/**
 * Inclusive `date_from`/`date_to` (Y-m-d). date_to defaults to today, date_from to the first day of
 * the year of date_to.
 */
abstract class RangeReportRequest extends InventoryReportRequest
{
    /** @return array<string, mixed> */
    protected function rangeRules(): array
    {
        return [
            'date_from' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'date_to' => ['sometimes', 'nullable', 'date_format:Y-m-d', 'after_or_equal:date_from'],
        ];
    }

    public function dateTo(): string
    {
        return $this->text('date_to') ?? $this->today();
    }

    public function dateFrom(): string
    {
        $from = $this->text('date_from') ?? substr($this->dateTo(), 0, 4).'-01-01';

        return $from > $this->dateTo() ? $this->dateTo() : $from;
    }
}
