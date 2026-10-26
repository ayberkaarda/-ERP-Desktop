<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Policies;

use App\Models\User;

/** Gate ability `inventory.reports.view` of the stock reports, checked before any validation or lookup. */
final class InventoryReportPolicy extends InventoryPolicy
{
    public const string ABILITY = 'inventory.reports.view';

    public function view(User $user): bool
    {
        return $this->allowed($user, null, self::ABILITY);
    }
}
