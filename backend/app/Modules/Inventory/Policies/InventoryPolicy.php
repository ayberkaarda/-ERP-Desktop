<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Policies;

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Identity\Contracts\CompanyAuthorizer;
use Illuminate\Database\Eloquent\Model;

/**
 * Abilities are checked with the class (permission only, before any lookup or validation) and again
 * with the record (same company). Each ability accepts any of its permissions.
 */
abstract class InventoryPolicy
{
    protected function allowed(User $user, ?Model $model, string ...$permissions): bool
    {
        $company = app(CompanyContext::class)->idOrNull();

        if ($company === null || ($model !== null && $model->getAttribute('company_id') !== $company)) {
            return false;
        }

        foreach ($permissions as $permission) {
            if (app(CompanyAuthorizer::class)->allows($user, $permission, $company)) {
                return true;
            }
        }

        return false;
    }
}
