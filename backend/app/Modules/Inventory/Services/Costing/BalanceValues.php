<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Services\Costing;

use App\Modules\Inventory\Support\Stock;
use Brick\Math\BigDecimal;
use Illuminate\Support\Facades\DB;

/**
 * Spreads the authoritative value of an (item, warehouse) pair over its balance rows: each row
 * gets on_hand x average (scale 4) and the rounding remainder goes to the row with the most stock,
 * so the rows always add up to the pair value (and so to the ledger).
 */
final class BalanceValues
{
    public static function distribute(string $companyId, string $itemId, string $warehouseId, BigDecimal $avgCost, BigDecimal $value): void
    {
        $rows = DB::table('stock_balances')->where('company_id', $companyId)->where('item_id', $itemId)->where('warehouse_id', $warehouseId)
            ->orderByDesc('on_hand')->orderBy('location_id')->orderBy('lot_id')
            ->get(['location_id', 'lot_id', 'on_hand']);

        if ($rows->isEmpty()) {
            return;
        }

        $values = [];
        $sum = BigDecimal::zero();

        foreach ($rows as $i => $row) {
            $values[$i] = Stock::money(Stock::dec((string) $row->on_hand)->multipliedBy($avgCost));
            $sum = $sum->plus($values[$i]);
        }

        // The first row holds the most stock.
        $values[0] = $values[0]->plus(Stock::money($value)->minus($sum));

        foreach ($rows as $i => $row) {
            DB::update(
                'UPDATE stock_balances SET avg_cost = ?, value = ?, updated_at = now()
                 WHERE company_id = ? AND item_id = ? AND warehouse_id = ? AND location_id = ? AND lot_id = ?',
                [(string) $avgCost, (string) $values[$i], $companyId, $itemId, $warehouseId, (string) $row->location_id, (string) $row->lot_id],
            );
        }
    }
}
