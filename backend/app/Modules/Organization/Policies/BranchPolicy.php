<?php

declare(strict_types=1);

namespace App\Modules\Organization\Policies;

use App\Models\User;
use App\Modules\Organization\Models\Branch;

final class BranchPolicy
{
    use ChecksActiveCompany;

    public function viewAny(User $user): bool
    {
        return $this->allowed($user, 'branches.view');
    }

    public function view(User $user, Branch $branch): bool
    {
        return $this->allowed($user, 'branches.view');
    }

    public function create(User $user): bool
    {
        return $this->allowed($user, 'branches.create');
    }

    public function update(User $user, Branch $branch): bool
    {
        return $this->allowed($user, 'branches.update');
    }

    public function delete(User $user, Branch $branch): bool
    {
        return $this->allowed($user, 'branches.delete');
    }
}
