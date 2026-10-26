<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http\Controllers;

use App\Core\Http\ApiException;
use App\Core\Http\ApiResponse;
use App\Core\Http\ErrorCode;
use App\Modules\Identity\Enums\SessionEvent;
use App\Modules\Identity\Http\Requests\DeviceLoginRequest;
use App\Modules\Identity\Http\Requests\DeviceRefreshRequest;
use App\Modules\Identity\Http\Resources\DeviceResource;
use App\Modules\Identity\Models\UserDevice;
use App\Modules\Identity\Services\CredentialVerifier;
use App\Modules\Identity\Services\DeviceTokens;
use App\Modules\Identity\Services\LoginThrottle;
use App\Modules\Identity\Services\SessionLogger;
use App\Modules\Identity\Services\TwoFactorService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

final class DeviceController
{
    use CurrentUser;

    public function __construct(private readonly DeviceTokens $tokens) {}

    /**
     * POST /auth/device: credentials (+ TOTP when enabled) for a desktop token.
     */
    public function login(
        DeviceLoginRequest $request,
        CredentialVerifier $credentials,
        TwoFactorService $twoFactor,
        LoginThrottle $throttle,
        SessionLogger $logger,
    ): JsonResponse {
        $email = $request->string('email')->toString();
        $user = $credentials->verify($request, $email, $request->string('password')->toString());

        if ($user->hasTwoFactorEnabled()) {
            $code = $request->input('two_factor_code');

            if (! is_string($code) || $code === '') {
                throw new ApiException(ErrorCode::TwoFactorRequired);
            }

            $key = LoginThrottle::key('two_factor', $user->id, $request->ip());

            if ($throttle->isLocked($key)) {
                throw $throttle->lockedException($key);
            }

            $valid = preg_match('/^\s*\d{6}\s*$/', $code) === 1
                ? $twoFactor->verifyCode($user, $code)
                : $twoFactor->useRecoveryCode($user, $code);

            if (! $valid) {
                $logger->log(SessionEvent::TwoFactorFailed, $request, $user);
                $throttle->fail($key);

                throw new ApiException(ErrorCode::InvalidTwoFactorCode);
            }

            $throttle->clear($key);
        }

        $credentials->clear($request, $email);
        $issued = $this->tokens->issue(
            $user,
            $request,
            $request->string('device_name')->toString(),
            $request->string('fingerprint')->toString(),
        );
        $logger->log(SessionEvent::DeviceLogin, $request, $user);

        return ApiResponse::success($issued);
    }

    /**
     * POST /auth/device/refresh: rotates the refresh token (unauthenticated, the access token may be expired).
     */
    public function refresh(DeviceRefreshRequest $request): JsonResponse
    {
        return ApiResponse::success($this->tokens->refresh($request->string('refresh_token')->toString()));
    }

    public function index(Request $request): JsonResponse
    {
        $user = $this->currentUser($request);
        Gate::authorize('viewAny', UserDevice::class);

        $devices = UserDevice::query()->where('user_id', $user->id)->orderByDesc('created_at')->get();

        return ApiResponse::success(DeviceResource::collection($devices)->resolve($request));
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $user = $this->currentUser($request);
        $device = UserDevice::query()->where('user_id', $user->id)->findOrFail($id);
        Gate::authorize('delete', $device);

        $this->tokens->revoke($user, $device);

        return ApiResponse::noContent();
    }
}
