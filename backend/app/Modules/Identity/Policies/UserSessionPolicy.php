<?php

declare(strict_types=1);

namespace App\Modules\Identity\Policies;

use App\Models\User;
use App\Modules\Identity\Models\UserSession;

/**
 * Own sessions only. Controllers also look rows up by owner, so the super admin gate bypass
 * can never reach another user's session.
 */
final class UserSessionPolicy
{
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function delete(User $user, UserSession $session): bool
    {
        return $session->user_id === $user->id;
    }
}
