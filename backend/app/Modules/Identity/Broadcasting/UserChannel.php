<?php

declare(strict_types=1);

namespace App\Modules\Identity\Broadcasting;

use App\Models\User;

/**
 * private-user.{id}: only that user.
 */
final class UserChannel
{
    public function join(mixed $user, string $id): bool
    {
        return $user instanceof User && $user->is_active && hash_equals($user->id, $id);
    }
}
