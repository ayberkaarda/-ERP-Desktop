<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Resources\Reports;

use Illuminate\Http\Request;

/**
 * Turnover row: opening/closing stock, consumption, average stock value, turnover (times) and days
 * on hand; quantities are null for warehouse and category rows.
 */
final class TurnoverRowResource extends ReportRowResource
{
    /** @return array{item_id: string|null, item_code: string|null, item_name: string|null, base_unit_id: string|null, warehouse_id: string|null, warehouse_code: string|null, warehouse_name: string|null, category_id: string|null, category_code: string|null, category_name: string|null, item_count: int, opening_quantity: string|null, opening_value: string, closing_quantity: string|null, closing_value: string, consumed_quantity: string|null, consumed_value: string, average_value: string, turnover: string|null, days_on_hand: string|null} */
    public function toArray(Request $request): array
    {
        /** @var array{item_id: string|null, item_code: string|null, item_name: string|null, base_unit_id: string|null, warehouse_id: string|null, warehouse_code: string|null, warehouse_name: string|null, category_id: string|null, category_code: string|null, category_name: string|null, item_count: int, opening_quantity: string|null, opening_value: string, closing_quantity: string|null, closing_value: string, consumed_quantity: string|null, consumed_value: string, average_value: string, turnover: string|null, days_on_hand: string|null} */
        return $this->row();
    }
}
