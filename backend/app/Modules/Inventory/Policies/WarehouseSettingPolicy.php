<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Policies;

use App\Models\User;

/**
 * Warehouses as the stock ledger sees them (Reference master data plus inventory policy).
 */
final class WarehouseSettingPolicy extends InventoryPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->allowed($user, null, 'inventory.warehouses.view', 'inventory.warehouses.manage', 'inventory.stock.view', 'inventory.documents.view', 'inventory.reservations.manage');
    }

    public function update(User $user): bool
    {
        return $this->allowed($user, null, 'inventory.warehouses.manage');
    }
}
