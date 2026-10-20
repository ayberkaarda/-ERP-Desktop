<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http\Controllers;

use App\Core\Http\ApiException;
use App\Core\Http\ApiResponse;
use App\Core\Http\ErrorCode;
use App\Models\User;
use App\Modules\Identity\Enums\SessionEvent;
use App\Modules\Identity\Http\Requests\LoginRequest;
use App\Modules\Identity\Http\Requests\TwoFactorVerifyRequest;
use App\Modules\Identity\Http\Resources\AuthUserResource;
use App\Modules\Identity\Services\CredentialVerifier;
use App\Modules\Identity\Services\LoginThrottle;
use App\Modules\Identity\Services\MeAssembler;
use App\Modules\Identity\Services\SessionAuthenticator;
use App\Modules\Identity\Services\SessionLogger;
use App\Modules\Identity\Services\TwoFactorService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class AuthController
{
    public function __construct(
        private readonly CredentialVerifier $credentials,
        private readonly SessionAuthenticator $authenticator,
        private readonly TwoFactorService $twoFactor,
        private readonly LoginThrottle $throttle,
        private readonly SessionLogger $logger,
    ) {}

    public function login(LoginRequest $request): JsonResponse
    {
        $this->authenticator->requireSession($request);

        $email = $request->string('email')->toString();
        $user = $this->credentials->verify($request, $email, $request->string('password')->toString());
        $remember = $request->boolean('remember');

        if ($user->hasTwoFactorEnabled()) {
            $this->authenticator->startChallenge($request, $user, $remember);

            return ApiResponse::success(['user' => null, 'two_factor_required' => true]);
        }

        $this->credentials->clear($request, $email);
        $this->authenticator->login($request, $user, $remember);

        return ApiResponse::success([
            'user' => (new AuthUserResource($user))->resolve($request),
            'two_factor_required' => false,
        ]);
    }

    public function verifyTwoFactor(TwoFactorVerifyRequest $request): JsonResponse
    {
        $this->authenticator->requireSession($request);
        $pending = $this->authenticator->pendingChallenge($request);

        if ($pending === null) {
            throw new ApiException(ErrorCode::Unauthenticated);
        }

        $user = $pending['user'];

        if (! $user->is_active) {
            $this->authenticator->clearChallenge($request);

            throw new ApiException(ErrorCode::UserDeactivated);
        }

        $key = LoginThrottle::key('two_factor', $user->id, $request->ip());

        if ($this->throttle->isLocked($key)) {
            throw $this->throttle->lockedException($key);
        }

        $code = $request->input('code');
        $recovery = $request->input('recovery_code');
        $valid = is_string($code) && $code !== ''
            ? $this->twoFactor->verifyCode($user, $code)
            : is_string($recovery) && $this->twoFactor->useRecoveryCode($user, $recovery);

        if (! $valid) {
            $this->logger->log(SessionEvent::TwoFactorFailed, $request, $user);

            if ($this->throttle->fail($key)) {
                $this->logger->log(SessionEvent::Lockout, $request, $user);
            }

            throw new ApiException(ErrorCode::InvalidTwoFactorCode);
        }

        $this->throttle->clear($key);
        $this->credentials->clear($request, $user->email);
        $this->authenticator->clearChallenge($request);
        $this->authenticator->login($request, $user, $pending['remember']);

        return ApiResponse::success([
            'user' => (new AuthUserResource($user))->resolve($request),
            'two_factor_required' => false,
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        $user = $request->user();

        if ($user instanceof User) {
            $this->authenticator->logout($request, $user);
        }

        return ApiResponse::noContent();
    }

    public function me(Request $request, MeAssembler $me): JsonResponse
    {
        $user = $request->user();

        if (! $user instanceof User) {
            throw new ApiException(ErrorCode::Unauthenticated);
        }

        return ApiResponse::success($me->for($user, $request));
    }
}
