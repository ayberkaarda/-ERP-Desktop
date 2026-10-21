<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Policies;

use App\Models\User;
use App\Modules\Accounting\Policies\AccountingPolicy;

/** Gate ability `accounting.reports.view`, checked before any validation or lookup. */
final class ReportPolicy extends AccountingPolicy
{
    public const string ABILITY = 'accounting.reports.view';

    public function view(User $user): bool
    {
        return $this->allowed($user, null, 'accounting.reports.view');
    }
}
