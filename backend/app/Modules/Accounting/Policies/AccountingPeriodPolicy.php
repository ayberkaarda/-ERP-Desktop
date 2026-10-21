<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Policies;

use App\Models\User;
use App\Modules\Accounting\Models\AccountingPeriod;

final class AccountingPeriodPolicy extends AccountingPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->allowed($user, null, 'accounting.periods.view', 'accounting.periods.manage', 'accounting.periods.close');
    }

    public function view(User $user, ?AccountingPeriod $period = null): bool
    {
        return $this->allowed($user, $period, 'accounting.periods.view', 'accounting.periods.manage', 'accounting.periods.close');
    }

    /** Soft close and close. */
    public function close(User $user, ?AccountingPeriod $period = null): bool
    {
        return $this->allowed($user, $period, 'accounting.periods.close');
    }

    public function reopen(User $user, ?AccountingPeriod $period = null): bool
    {
        return $this->allowed($user, $period, 'accounting.periods.reopen');
    }
}
