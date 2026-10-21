<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Policies;

use App\Models\User;
use App\Modules\Accounting\Models\FiscalYear;

final class FiscalYearPolicy extends AccountingPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->allowed($user, null, 'accounting.periods.view', 'accounting.periods.manage');
    }

    public function view(User $user, ?FiscalYear $year = null): bool
    {
        return $this->allowed($user, $year, 'accounting.periods.view', 'accounting.periods.manage');
    }

    public function create(User $user): bool
    {
        return $this->allowed($user, null, 'accounting.periods.manage');
    }

    public function update(User $user, ?FiscalYear $year = null): bool
    {
        return $this->allowed($user, $year, 'accounting.periods.manage');
    }

    public function close(User $user, ?FiscalYear $year = null): bool
    {
        return $this->allowed($user, $year, 'accounting.year.close');
    }

    public function reopen(User $user, ?FiscalYear $year = null): bool
    {
        return $this->allowed($user, $year, 'accounting.year.close');
    }
}
