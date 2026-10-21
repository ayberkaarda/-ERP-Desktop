<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Resources\Reports;

use Illuminate\Http\Request;

/**
 * One kartex line: the movement, its quantity and value in or out, and the running balance after it.
 */
final class StockLedgerLineResource extends ReportRowResource
{
    /** @return array{seq: int, occurred_at: string, movement_type: string, direction: string, warehouse_id: string, warehouse_code: string|null, location_id: string|null, lot_no: string|null, serial_no: string|null, document_type: string, document_id: string, document_number: string|null, quantity_in: string, quantity_out: string, unit_cost: string, value_in: string, value_out: string, balance_quantity: string, balance_value: string, balance_avg_cost: string, reverses_id: string|null, movement_id: string} */
    public function toArray(Request $request): array
    {
        /** @var array{seq: int, occurred_at: string, movement_type: string, direction: string, warehouse_id: string, warehouse_code: string|null, location_id: string|null, lot_no: string|null, serial_no: string|null, document_type: string, document_id: string, document_number: string|null, quantity_in: string, quantity_out: string, unit_cost: string, value_in: string, value_out: string, balance_quantity: string, balance_value: string, balance_avg_cost: string, reverses_id: string|null, movement_id: string} */
        return $this->row();
    }
}
