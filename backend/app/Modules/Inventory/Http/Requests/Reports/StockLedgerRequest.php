<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Requests\Reports;

/**
 * `item_id` (required); optional `warehouse_id`; date_from/date_to.
 */
final class StockLedgerRequest extends RangeReportRequest
{
    /** @return array<string, mixed> */
    protected function reportRules(): array
    {
        return [
            ...$this->rangeRules(),
            'item_id' => ['required', 'uuid'],
        ];
    }

    public function itemId(): string
    {
        return (string) $this->text('item_id');
    }
}
