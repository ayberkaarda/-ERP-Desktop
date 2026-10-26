<?php

declare(strict_types=1);

namespace App\Modules\Identity\Policies;

use App\Models\User;

final class SessionLogPolicy
{
    use ChecksCompanyPermission;

    public function viewAny(User $user): bool
    {
        return $this->allowedInActiveCompany($user, 'session_logs.view');
    }
}
