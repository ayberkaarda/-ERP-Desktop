<?php

declare(strict_types=1);

namespace App\Modules\Organization\Policies;

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Identity\Contracts\CompanyAuthorizer;

trait ChecksActiveCompany
{
    protected function allowed(User $user, string $permission): bool
    {
        $company = app(CompanyContext::class)->idOrNull();

        return $company !== null && app(CompanyAuthorizer::class)->allows($user, $permission, $company);
    }
}
