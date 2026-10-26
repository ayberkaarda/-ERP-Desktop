<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http\Controllers;

use App\Core\Http\ApiException;
use App\Core\Http\ApiResponse;
use App\Core\Http\ErrorCode;
use App\Modules\Identity\Http\Requests\PasswordChangeRequest;
use App\Modules\Identity\Models\UserDevice;
use App\Modules\Identity\Services\AccessRevoker;
use App\Modules\Identity\Services\DeviceTokens;
use App\Modules\Identity\Services\LoginThrottle;
use App\Modules\Identity\Services\SessionRegistry;
use App\Modules\Identity\Support\CurrentToken;
use Illuminate\Contracts\Hashing\Hasher;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;

final class PasswordController
{
    use CurrentUser;

    /**
     * Changing the password ends every other session and device token; the current session stays.
     */
    public function change(
        PasswordChangeRequest $request,
        Hasher $hasher,
        LoginThrottle $throttle,
        SessionRegistry $sessions,
        AccessRevoker $revoker,
        DeviceTokens $tokens,
    ): JsonResponse {
        $user = $this->currentUser($request);
        $key = LoginThrottle::key('password_change', $user->id, $request->ip());

        if ($throttle->isLocked($key)) {
            throw $throttle->lockedException($key);
        }

        if (! $hasher->check($request->string('current_password')->toString(), $user->password)) {
            $throttle->fail($key);

            throw new ApiException(ErrorCode::ValidationError, fields: [
                'current_password' => [__('identity::auth.current_password_invalid')],
            ]);
        }

        $throttle->clear($key);

        $user->forceFill([
            'password' => $request->string('password')->toString(),
            'must_change_password' => false,
            'password_changed_at' => Carbon::now(),
        ])->save();
        $user->bumpAuthVersion();

        $token = CurrentToken::of($user);
        $revoker->revokeAll(
            $user,
            'password_changed',
            $sessions->currentHash($request),
            $token === null ? null : (string) $token->getKey(),
            broadcast: false,
        );

        // A desktop client keeps its sign-in with a fresh token pair; every older refresh token is void.
        if ($token !== null) {
            $device = UserDevice::query()->where('user_id', $user->id)->where('token_id', (string) $token->getKey())->first();
            $issued = $device instanceof UserDevice ? $tokens->reissue($user, $device) : null;

            if ($issued !== null) {
                return ApiResponse::success($issued);
            }
        }

        return ApiResponse::noContent();
    }
}
