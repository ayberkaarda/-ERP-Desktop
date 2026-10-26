<?php

declare(strict_types=1);

namespace App\Modules\Notifications\Policies;

use App\Modules\Notifications\Models\Notification;
use Illuminate\Contracts\Auth\Authenticatable;

/**
 * Notifications are strictly personal; no permission can widen this.
 */
final class NotificationPolicy
{
    public function viewAny(Authenticatable $user): bool
    {
        return true;
    }

    public function update(Authenticatable $user, Notification $notification): bool
    {
        return (string) $user->getAuthIdentifier() === $notification->user_id;
    }
}
