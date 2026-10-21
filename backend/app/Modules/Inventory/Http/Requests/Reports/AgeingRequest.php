<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Requests\Reports;

/**
 * as_of; group_by item_warehouse (default) | item.
 */
final class AgeingRequest extends AsOfReportRequest
{
    /** @return array<string, mixed> */
    protected function reportRules(): array
    {
        return [
            ...$this->asOfRules(),
            'group_by' => ['sometimes', 'nullable', 'in:item_warehouse,item'],
        ];
    }

    public function groupBy(): string
    {
        return $this->text('group_by') ?? 'item_warehouse';
    }
}
