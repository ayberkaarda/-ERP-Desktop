<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Resources\Reports;

use Illuminate\Http\Request;

/**
 * Stock status / valuation row. Identity fields not part of the grouping are null; quantity and
 * avg_cost are null for warehouse and category rows.
 */
final class StockStatusRowResource extends ReportRowResource
{
    /** @return array{item_id: string|null, item_code: string|null, item_name: string|null, base_unit_id: string|null, warehouse_id: string|null, warehouse_code: string|null, warehouse_name: string|null, category_id: string|null, category_code: string|null, category_name: string|null, item_count: int, quantity: string|null, avg_cost: string|null, value: string} */
    public function toArray(Request $request): array
    {
        /** @var array{item_id: string|null, item_code: string|null, item_name: string|null, base_unit_id: string|null, warehouse_id: string|null, warehouse_code: string|null, warehouse_name: string|null, category_id: string|null, category_code: string|null, category_name: string|null, item_count: int, quantity: string|null, avg_cost: string|null, value: string} */
        return $this->row();
    }
}
