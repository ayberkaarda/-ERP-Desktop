<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Assistant;

use App\Modules\Catalog\Contracts\ItemLookup;
use App\Modules\Inventory\Contracts\StockAvailability;
use App\Modules\Inventory\Contracts\WarehouseLookup;

final class ReadService
{
    /** @return array<string, mixed> */
    public function availability(string $company, string $item, string $warehouse): array
    {
        $data = ['item_id' => $item, 'warehouse_id' => $warehouse];
        $warehouse = app(WarehouseLookup::class)->find((string) $data['warehouse_id']);
        abort_if($warehouse === null, 404);
        abort_if(app(ItemLookup::class)->find($item) === null, 404);

        return ['item_id' => $data['item_id'], 'warehouse_id' => $data['warehouse_id'], 'available' => app(StockAvailability::class)->available($company, (string) $data['item_id'], (string) $data['warehouse_id'])];
    }
}
