<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Contracts;

use App\Modules\Inventory\Data\Valuation;

interface StockAvailability
{
    /** On hand minus reserved in base units (scale 6); with a lot, of that lot only. */
    public function available(string $companyId, string $itemId, string $warehouseId, ?string $lotId = null): string;

    /** Quantity, average cost and value of an item in one warehouse, or across all warehouses. */
    public function valuation(string $companyId, string $itemId, ?string $warehouseId = null): Valuation;
}
