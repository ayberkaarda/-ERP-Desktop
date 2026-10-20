<?php

declare(strict_types=1);

namespace App\Modules\Identity\Services;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Models\User;
use App\Modules\Identity\Enums\SessionEvent;
use Illuminate\Auth\AuthManager;
use Illuminate\Auth\SessionGuard;
use Illuminate\Contracts\Auth\StatefulGuard;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/**
 * SPA cookie session sign-in and sign-out, including the pending two-factor challenge.
 */
final class SessionAuthenticator
{
    private const string CHALLENGE = 'identity.two_factor_challenge';

    public function __construct(
        private readonly AuthManager $auth,
        private readonly SessionRegistry $sessions,
        private readonly SessionLogger $logger,
    ) {}

    public function requireSession(Request $request): void
    {
        if (! $request->hasSession()) {
            throw new ApiException(ErrorCode::HttpError, __('identity::auth.session_required'));
        }
    }

    public function login(Request $request, User $user, bool $remember): void
    {
        $this->guard()->login($user, $remember);
        $request->session()->regenerate();

        $user->forceFill(['last_login_at' => Carbon::now()])->save();
        $this->sessions->track($request, $user, true);
        $this->logger->log(SessionEvent::Login, $request, $user);
    }

    public function logout(Request $request, User $user): void
    {
        $this->logger->log(SessionEvent::Logout, $request, $user);
        $this->sessions->forgetCurrent($request);
        $guard = $this->guard();

        // logout() would cycle the remember token and end remember-me on every other device too.
        $guard instanceof SessionGuard ? $guard->logoutCurrentDevice() : $guard->logout();

        if ($request->hasSession()) {
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }
    }

    public function startChallenge(Request $request, User $user, bool $remember): void
    {
        $seconds = config('identity.two_factor.challenge_seconds', 300);

        $request->session()->regenerate();
        $request->session()->put(self::CHALLENGE, [
            'user_id' => $user->id,
            'remember' => $remember,
            'expires_at' => Carbon::now()->addSeconds(is_numeric($seconds) ? (int) $seconds : 300)->getTimestamp(),
        ]);
    }

    /**
     * @return array{user: User, remember: bool}|null
     */
    public function pendingChallenge(Request $request): ?array
    {
        $challenge = $request->session()->get(self::CHALLENGE);

        if (! is_array($challenge) || ! isset($challenge['user_id'], $challenge['expires_at']) || ! is_string($challenge['user_id'])) {
            return null;
        }

        if (! is_int($challenge['expires_at']) || $challenge['expires_at'] < Carbon::now()->getTimestamp()) {
            $this->clearChallenge($request);

            return null;
        }

        $user = User::query()->find($challenge['user_id']);

        return $user instanceof User ? ['user' => $user, 'remember' => (bool) ($challenge['remember'] ?? false)] : null;
    }

    public function clearChallenge(Request $request): void
    {
        $request->session()->forget(self::CHALLENGE);
    }

    private function guard(): StatefulGuard
    {
        $guard = $this->auth->guard('web');

        if (! $guard instanceof StatefulGuard) {
            throw new ApiException(ErrorCode::ServerError);
        }

        return $guard;
    }
}
