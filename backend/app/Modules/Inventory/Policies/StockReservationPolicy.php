<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Policies;

use App\Models\User;
use App\Modules\Inventory\Models\StockReservation;

final class StockReservationPolicy extends InventoryPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->allowed($user, null, 'inventory.reservations.manage', 'inventory.stock.view');
    }

    public function view(User $user, ?StockReservation $reservation = null): bool
    {
        return $this->allowed($user, $reservation, 'inventory.reservations.manage', 'inventory.stock.view');
    }

    public function create(User $user): bool
    {
        return $this->allowed($user, null, 'inventory.reservations.manage');
    }

    public function release(User $user, ?StockReservation $reservation = null): bool
    {
        return $this->allowed($user, $reservation, 'inventory.reservations.manage');
    }
}
