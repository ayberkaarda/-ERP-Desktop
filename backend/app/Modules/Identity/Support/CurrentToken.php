<?php

declare(strict_types=1);

namespace App\Modules\Identity\Support;

use App\Models\User;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * The request's personal access token, if it was authenticated by one. Session requests and
 * Sanctum::actingAs carry none or a transient token.
 */
final class CurrentToken
{
    public static function of(User $user): ?PersonalAccessToken
    {
        $token = self::raw($user);

        return $token instanceof PersonalAccessToken && $token->exists ? $token : null;
    }

    private static function raw(User $user): mixed
    {
        return $user->currentAccessToken();
    }
}
