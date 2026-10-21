<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Policies;

use App\Models\User;
use App\Modules\Accounting\Models\AccountDeterminationRule;

final class DeterminationRulePolicy extends AccountingPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->allowed($user, null, 'accounting.determination.manage');
    }

    public function view(User $user, ?AccountDeterminationRule $rule = null): bool
    {
        return $this->allowed($user, $rule, 'accounting.determination.manage');
    }

    public function create(User $user): bool
    {
        return $this->allowed($user, null, 'accounting.determination.manage');
    }

    public function update(User $user, ?AccountDeterminationRule $rule = null): bool
    {
        return $this->allowed($user, $rule, 'accounting.determination.manage');
    }

    public function delete(User $user, ?AccountDeterminationRule $rule = null): bool
    {
        return $this->allowed($user, $rule, 'accounting.determination.manage');
    }

    public function test(User $user): bool
    {
        return $this->allowed($user, null, 'accounting.determination.manage');
    }
}
