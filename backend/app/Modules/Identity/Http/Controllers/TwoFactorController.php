<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http\Controllers;

use App\Core\Http\ApiException;
use App\Core\Http\ApiResponse;
use App\Core\Http\ErrorCode;
use App\Modules\Identity\Http\Requests\PasswordConfirmationRequest;
use App\Modules\Identity\Http\Requests\TwoFactorConfirmRequest;
use App\Modules\Identity\Services\LoginThrottle;
use App\Modules\Identity\Services\TwoFactorService;
use Illuminate\Contracts\Hashing\Hasher;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The signed-in user's own two-factor settings.
 */
final class TwoFactorController
{
    use CurrentUser;

    public function __construct(
        private readonly TwoFactorService $twoFactor,
        private readonly LoginThrottle $throttle,
    ) {}

    public function setup(Request $request): JsonResponse
    {
        return ApiResponse::success($this->twoFactor->beginSetup($this->currentUser($request)));
    }

    public function confirm(TwoFactorConfirmRequest $request): JsonResponse
    {
        $user = $this->currentUser($request);
        $key = LoginThrottle::key('two_factor_confirm', $user->id, $request->ip());

        if ($this->throttle->isLocked($key)) {
            throw $this->throttle->lockedException($key);
        }

        try {
            $codes = $this->twoFactor->confirm($user, $request->string('code')->toString());
        } catch (ApiException $e) {
            if ($e->errorCode === ErrorCode::InvalidTwoFactorCode) {
                $this->throttle->fail($key);
            }

            throw $e;
        }

        $this->throttle->clear($key);

        return ApiResponse::success(['recovery_codes' => $codes]);
    }

    public function disable(PasswordConfirmationRequest $request, Hasher $hasher): JsonResponse
    {
        $user = $this->currentUser($request);
        $key = LoginThrottle::key('two_factor_disable', $user->id, $request->ip());

        if ($this->throttle->isLocked($key)) {
            throw $this->throttle->lockedException($key);
        }

        if (! $hasher->check($request->string('password')->toString(), $user->password)) {
            $this->throttle->fail($key);

            throw new ApiException(ErrorCode::ValidationError, fields: [
                'password' => [__('identity::auth.current_password_invalid')],
            ]);
        }

        $this->throttle->clear($key);
        $this->twoFactor->disable($user);

        return ApiResponse::noContent();
    }
}
