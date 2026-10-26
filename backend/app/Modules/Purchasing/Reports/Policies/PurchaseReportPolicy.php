<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Reports\Policies;

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Identity\Contracts\CompanyAuthorizer;

/** Gate ability `purchasing.reports.view` of the purchasing reports, checked before any validation or lookup. */
final class PurchaseReportPolicy
{
    public const string ABILITY = 'purchasing.reports.view';

    public function view(User $user): bool
    {
        $company = app(CompanyContext::class)->idOrNull();

        return $company !== null && app(CompanyAuthorizer::class)->allows($user, self::ABILITY, $company);
    }
}
