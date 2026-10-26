<?php

declare(strict_types=1);

namespace App\Modules\Organization\Policies;

use App\Models\User;
use App\Modules\Organization\Models\Department;

final class DepartmentPolicy
{
    use ChecksActiveCompany;

    public function viewAny(User $user): bool
    {
        return $this->allowed($user, 'departments.view');
    }

    public function view(User $user, Department $department): bool
    {
        return $this->allowed($user, 'departments.view');
    }

    public function create(User $user): bool
    {
        return $this->allowed($user, 'departments.create');
    }

    public function update(User $user, Department $department): bool
    {
        return $this->allowed($user, 'departments.update');
    }

    public function delete(User $user, Department $department): bool
    {
        return $this->allowed($user, 'departments.delete');
    }
}
