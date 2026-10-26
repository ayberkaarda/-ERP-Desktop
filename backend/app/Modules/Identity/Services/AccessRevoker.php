<?php

declare(strict_types=1);

namespace App\Modules\Identity\Services;

use App\Models\User;
use App\Modules\Identity\Events\SessionRevoked;
use App\Modules\Identity\Models\UserDevice;
use Illuminate\Support\Str;

/**
 * Cuts every way a user is signed in: browser sessions, remember-me cookies, device tokens.
 */
final class AccessRevoker
{
    public function __construct(private readonly SessionRegistry $sessions) {}

    public function revokeAll(
        User $user,
        string $reason,
        ?string $keepSessionHash = null,
        ?string $keepTokenId = null,
        bool $broadcast = true,
    ): void {
        $this->sessions->revokeAll($user, $keepSessionHash);
        $this->rotateRememberToken($user);

        $devices = UserDevice::query()->where('user_id', $user->id);
        $tokens = $user->tokens();

        if ($keepTokenId !== null) {
            $devices->where(fn ($q) => $q->whereNull('token_id')->orWhere('token_id', '!=', $keepTokenId));
            $tokens->whereKeyNot($keepTokenId);
        }

        $devices->delete();
        $tokens->delete();

        if ($broadcast) {
            SessionRevoked::dispatch($user->id, $reason);
        }
    }

    /**
     * Remember-me cookies would silently re-create a revoked session; a new token invalidates them all.
     */
    public function rotateRememberToken(User $user): void
    {
        $user->forceFill(['remember_token' => Str::random(60)])->save();
    }
}
