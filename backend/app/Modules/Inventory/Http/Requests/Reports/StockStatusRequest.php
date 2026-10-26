<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Requests\Reports;

use App\Modules\Inventory\Services\Reports\PairGroups;
use Illuminate\Validation\Rule;

/**
 * as_of; group_by item_warehouse (default) | item | warehouse | category; include_zero (default false).
 */
class StockStatusRequest extends AsOfReportRequest
{
    /** @return array<string, mixed> */
    protected function reportRules(): array
    {
        return [
            ...$this->asOfRules(),
            'group_by' => ['sometimes', 'nullable', Rule::in(PairGroups::GROUPINGS)],
            'include_zero' => self::boolRule(),
        ];
    }

    public function groupBy(): string
    {
        return $this->text('group_by') ?? 'item_warehouse';
    }

    public function includeZero(): bool
    {
        return $this->flag('include_zero', false);
    }
}
