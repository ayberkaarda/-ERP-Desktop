<?php

declare(strict_types=1);

namespace App\Modules\Sales\Reports\Policies;

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Identity\Contracts\CompanyAuthorizer;

/** Gate ability `sales.reports.view` of the sales reports, checked before any validation or lookup. */
final class SalesReportPolicy
{
    public const string ABILITY = 'sales.reports.view';

    public function view(User $user): bool
    {
        $company = app(CompanyContext::class)->idOrNull();

        return $company !== null && app(CompanyAuthorizer::class)->allows($user, self::ABILITY, $company);
    }
}
