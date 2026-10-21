<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Requests\Reports;

use App\Modules\Inventory\Services\Reports\PairGroups;
use Illuminate\Validation\Rule;

/**
 * date_from/date_to; group_by item (default) | item_warehouse | warehouse | category.
 */
final class TurnoverRequest extends RangeReportRequest
{
    /** @return array<string, mixed> */
    protected function reportRules(): array
    {
        return [
            ...$this->rangeRules(),
            'group_by' => ['sometimes', 'nullable', Rule::in(PairGroups::GROUPINGS)],
        ];
    }

    public function groupBy(): string
    {
        return $this->text('group_by') ?? 'item';
    }
}
