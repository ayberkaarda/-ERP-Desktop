<?php

declare(strict_types=1);

namespace App\Modules\Identity\Policies;

use App\Models\User;
use App\Modules\Identity\Models\UserDevice;

/**
 * Own devices only; controllers also look rows up by owner.
 */
final class UserDevicePolicy
{
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function delete(User $user, UserDevice $device): bool
    {
        return $device->user_id === $user->id;
    }
}
