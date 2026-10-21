<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Policies;

use App\Models\User;

/**
 * Stock read access: movements, balances, lots, serials, item stock and reorder suggestions.
 */
final class StockMovementPolicy extends InventoryPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->allowed($user, null, 'inventory.stock.view');
    }

    public function export(User $user): bool
    {
        return $this->allowed($user, null, 'inventory.stock.view');
    }
}
