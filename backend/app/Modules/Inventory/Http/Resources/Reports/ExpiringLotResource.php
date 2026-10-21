<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Resources\Reports;

use Illuminate\Http\Request;

/**
 * A lot in stock in one warehouse with its expiry; days_to_expiry is negative once expired.
 */
final class ExpiringLotResource extends ReportRowResource
{
    /** @return array{lot_id: string, lot_no: string, expiry_date: string, days_to_expiry: int, expired: bool, item_id: string, item_code: string|null, item_name: string|null, base_unit_id: string|null, warehouse_id: string, warehouse_code: string|null, warehouse_name: string|null, on_hand: string, reserved: string, available: string, value: string} */
    public function toArray(Request $request): array
    {
        /** @var array{lot_id: string, lot_no: string, expiry_date: string, days_to_expiry: int, expired: bool, item_id: string, item_code: string|null, item_name: string|null, base_unit_id: string|null, warehouse_id: string, warehouse_code: string|null, warehouse_name: string|null, on_hand: string, reserved: string, available: string, value: string} */
        return $this->row();
    }
}
