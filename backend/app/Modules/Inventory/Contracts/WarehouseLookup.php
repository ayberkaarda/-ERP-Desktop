<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Contracts;

use App\Modules\Inventory\Data\WarehouseData;

/**
 * Warehouses of the active company as the stock ledger sees them (master data plus policy).
 */
interface WarehouseLookup
{
    public function find(string $warehouseId): ?WarehouseData;

    /** The company's default warehouse, when one is marked. */
    public function default(): ?WarehouseData;

    /** The location exists, is not deleted and belongs to the warehouse. */
    public function locationBelongsTo(string $locationId, string $warehouseId): bool;

    /** Stock movements reference the warehouse (it must not be deleted). */
    public function hasMovements(string $warehouseId): bool;
}
