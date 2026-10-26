<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Policies;

use App\Models\User;
use App\Modules\Accounting\Models\Account;

final class AccountPolicy extends AccountingPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->allowed($user, null, 'accounting.accounts.view', 'accounting.accounts.manage');
    }

    public function view(User $user, ?Account $account = null): bool
    {
        return $this->allowed($user, $account, 'accounting.accounts.view', 'accounting.accounts.manage');
    }

    public function create(User $user): bool
    {
        return $this->allowed($user, null, 'accounting.accounts.manage');
    }

    public function update(User $user, ?Account $account = null): bool
    {
        return $this->allowed($user, $account, 'accounting.accounts.manage');
    }

    public function delete(User $user, ?Account $account = null): bool
    {
        return $this->allowed($user, $account, 'accounting.accounts.manage');
    }

    public function import(User $user): bool
    {
        return $this->allowed($user, null, 'accounting.accounts.manage');
    }
}
