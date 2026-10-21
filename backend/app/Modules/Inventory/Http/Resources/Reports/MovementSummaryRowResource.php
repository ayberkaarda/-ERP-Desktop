<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Resources\Reports;

use Illuminate\Http\Request;

/**
 * Movement summary row: opening, in, out and closing as quantity and value; quantities are null for
 * warehouse and category rows.
 */
final class MovementSummaryRowResource extends ReportRowResource
{
    /** @return array{item_id: string|null, item_code: string|null, item_name: string|null, base_unit_id: string|null, warehouse_id: string|null, warehouse_code: string|null, warehouse_name: string|null, category_id: string|null, category_code: string|null, category_name: string|null, item_count: int, opening_quantity: string|null, opening_value: string, in_quantity: string|null, in_value: string, out_quantity: string|null, out_value: string, closing_quantity: string|null, closing_value: string} */
    public function toArray(Request $request): array
    {
        /** @var array{item_id: string|null, item_code: string|null, item_name: string|null, base_unit_id: string|null, warehouse_id: string|null, warehouse_code: string|null, warehouse_name: string|null, category_id: string|null, category_code: string|null, category_name: string|null, item_count: int, opening_quantity: string|null, opening_value: string, in_quantity: string|null, in_value: string, out_quantity: string|null, out_value: string, closing_quantity: string|null, closing_value: string} */
        return $this->row();
    }
}
