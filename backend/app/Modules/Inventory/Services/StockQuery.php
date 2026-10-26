<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Services;

use App\Core\Company\CompanyContext;
use App\Modules\Inventory\Contracts\StockAvailability;
use App\Modules\Inventory\Data\Valuation;
use App\Modules\Inventory\Support\InventorySettings;
use App\Modules\Inventory\Support\Stock;
use Brick\Math\RoundingMode;
use Illuminate\Support\Facades\DB;

final class StockQuery implements StockAvailability
{
    public function __construct(
        private readonly CompanyContext $company,
        private readonly InventorySettings $settings,
    ) {}

    public function available(string $companyId, string $itemId, string $warehouseId, ?string $lotId = null): string
    {
        $row = DB::table('stock_balances')->where('company_id', $companyId)->where('item_id', $itemId)->where('warehouse_id', $warehouseId)
            ->when($lotId !== null, fn ($q) => $q->where('lot_id', $lotId))
            ->selectRaw('coalesce(sum(on_hand), 0) - coalesce(sum(reserved), 0) as available')->first();

        return Stock::qty(is_object($row) ? (string) $row->available : '0');
    }

    public function valuation(string $companyId, string $itemId, ?string $warehouseId = null): Valuation
    {
        $row = DB::table('stock_valuations')->where('company_id', $companyId)->where('item_id', $itemId)
            ->when($warehouseId !== null, fn ($q) => $q->where('warehouse_id', $warehouseId))
            ->selectRaw('coalesce(sum(quantity), 0) as quantity, coalesce(sum(value), 0) as value, max(avg_cost) as avg_cost, count(*) as n')->first();

        $qty = Stock::dec(is_object($row) ? (string) $row->quantity : '0');
        $value = Stock::money(is_object($row) ? (string) $row->value : '0');
        $scale = $this->company->runAs($companyId, fn (): int => $this->settings->costScale());

        if ($qty->isPositive()) {
            $avg = $value->dividedBy($qty, $scale, RoundingMode::HalfEven);
        } else {
            $avg = Stock::dec(is_object($row) && $row->avg_cost !== null && (int) $row->n === 1 ? (string) $row->avg_cost : '0')->toScale($scale, RoundingMode::HalfEven);
        }

        return new Valuation(Stock::qty($qty), (string) $avg, (string) $value);
    }
}
