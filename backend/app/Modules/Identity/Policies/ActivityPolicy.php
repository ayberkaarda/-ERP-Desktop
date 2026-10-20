<?php

declare(strict_types=1);

namespace App\Modules\Identity\Policies;

use App\Models\User;

final class ActivityPolicy
{
    use ChecksCompanyPermission;

    public function viewAny(User $user): bool
    {
        return $this->allowedInActiveCompany($user, 'audit.view');
    }

    public function export(User $user): bool
    {
        return $this->allowedInActiveCompany($user, 'audit.export');
    }
}
