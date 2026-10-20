<?php

declare(strict_types=1);

namespace App\Modules\Identity\Policies;

use App\Models\User;
use App\Modules\Identity\Models\Role;

final class RolePolicy
{
    use ChecksCompanyPermission;

    public function viewAny(User $user): bool
    {
        return $this->allowedInActiveCompany($user, 'roles.view');
    }

    public function view(User $user, Role $role): bool
    {
        return $this->allowedInActiveCompany($user, 'roles.view');
    }

    public function create(User $user): bool
    {
        return $this->allowedInActiveCompany($user, 'roles.create');
    }

    public function update(User $user, Role $role): bool
    {
        return $this->allowedInActiveCompany($user, 'roles.update');
    }

    public function delete(User $user, Role $role): bool
    {
        return $this->allowedInActiveCompany($user, 'roles.delete');
    }
}
