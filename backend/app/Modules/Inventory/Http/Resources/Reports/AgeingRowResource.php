<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Resources\Reports;

use Illuminate\Http\Request;

/**
 * Ageing row: quantity and value on hand, split into the 0-30, 31-60, 61-90 and over-90-day buckets.
 */
final class AgeingRowResource extends ReportRowResource
{
    /** @return array{item_id: string|null, item_code: string|null, item_name: string|null, base_unit_id: string|null, warehouse_id: string|null, warehouse_code: string|null, warehouse_name: string|null, category_id: string|null, category_code: string|null, category_name: string|null, quantity: string, value: string, qty_0_30: string, value_0_30: string, qty_31_60: string, value_31_60: string, qty_61_90: string, value_61_90: string, qty_over_90: string, value_over_90: string} */
    public function toArray(Request $request): array
    {
        /** @var array{item_id: string|null, item_code: string|null, item_name: string|null, base_unit_id: string|null, warehouse_id: string|null, warehouse_code: string|null, warehouse_name: string|null, category_id: string|null, category_code: string|null, category_name: string|null, quantity: string, value: string, qty_0_30: string, value_0_30: string, qty_31_60: string, value_31_60: string, qty_61_90: string, value_61_90: string, qty_over_90: string, value_over_90: string} */
        return $this->row();
    }
}
