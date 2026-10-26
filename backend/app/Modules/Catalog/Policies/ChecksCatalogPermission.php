<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Policies;

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Catalog\Models\CatalogModel;
use App\Modules\Identity\Contracts\CompanyAuthorizer;

trait ChecksCatalogPermission
{
    /** Any of the permissions in the active company. */
    protected function allowed(User $user, string ...$permissions): bool
    {
        $company = app(CompanyContext::class)->idOrNull();

        if ($company === null) {
            return false;
        }

        foreach ($permissions as $permission) {
            if (app(CompanyAuthorizer::class)->allows($user, $permission, $company)) {
                return true;
            }
        }

        return false;
    }

    /** Records are always loaded through the company scope; this guards hand-built instances too. */
    protected function own(CatalogModel $model): bool
    {
        return $model->company_id === app(CompanyContext::class)->idOrNull();
    }
}
