<?php

declare(strict_types=1);

namespace App\Core\Sync;

use Closure;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Support\Facades\Auth;

/**
 * Runs a sync write as the mutation's user on the default guard, for the REST chain the writer
 * replays (Gate, FormRequest::authorize, Auth::user() in services), and leaves the guard as it
 * was found: the previous user comes back, and a guard that had none is emptied again.
 * forgetUser clears the resolved user only; the session, remember cookies and other guards are
 * never touched, so a write never leaves the mutation's user logged in.
 */
final class ActingAs
{
    /**
     * @template T
     *
     * @param  Closure(): T  $write
     * @return T
     */
    public static function run(Authenticatable $user, Closure $write): mixed
    {
        $guard = Auth::guard();
        $previous = $guard->user();
        $switched = $previous?->getAuthIdentifier() !== $user->getAuthIdentifier();

        if ($switched) {
            $guard->setUser($user);
        }

        try {
            return $write();
        } finally {
            if ($switched && $previous !== null) {
                $guard->setUser($previous);
            } elseif ($switched) {
                $guard->forgetUser();
            }
        }
    }
}
