<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Policies;

use App\Models\User;

final class DiscountRulePolicy extends CatalogPolicy
{
    protected function viewPermissions(): array
    {
        return ['discount_rules.manage', 'pricing.view'];
    }

    protected function createPermissions(): array
    {
        return ['discount_rules.manage'];
    }

    /** GET /pricing/resolve. */
    public function resolve(User $user): bool
    {
        return $this->allowed($user, 'pricing.view');
    }
}
