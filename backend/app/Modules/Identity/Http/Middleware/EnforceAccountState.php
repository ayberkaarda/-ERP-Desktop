<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http\Middleware;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Models\User;
use App\Modules\Identity\Services\SessionRegistry;
use App\Modules\Identity\Support\CurrentToken;
use Closure;
use Illuminate\Auth\AuthManager;
use Illuminate\Auth\SessionGuard;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Appended to the `api` group, so no module can forget it: rejects deactivated accounts and, while
 * a password change is forced, every route except the allowlist below (broadcasting auth included).
 * Also keeps the session tracking row fresh.
 */
final class EnforceAccountState
{
    /** Route names a user with a forced password change may still call. */
    public const array PASSWORD_CHANGE_ALLOWLIST = ['auth.me', 'auth.logout', 'auth.password.change'];

    public function __construct(
        private readonly AuthManager $auth,
        private readonly SessionRegistry $sessions,
    ) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $this->auth->guard('sanctum')->user();

        if ($user instanceof User && ! $user->is_active) {
            $this->signOut($request, $user);

            throw new ApiException(ErrorCode::UserDeactivated);
        }

        if ($user instanceof User && $user->must_change_password
            && ! in_array($request->route()?->getName(), self::PASSWORD_CHANGE_ALLOWLIST, true)) {
            throw new ApiException(ErrorCode::PasswordChangeRequired);
        }

        $response = $next($request);

        $web = $this->auth->guard('web');

        if ($web instanceof SessionGuard && $web->hasUser()) {
            $current = $web->user();

            if ($current instanceof User && $current->is_active) {
                $this->sessions->track($request, $current);
            }
        }

        return $response;
    }

    private function signOut(Request $request, User $user): void
    {
        CurrentToken::of($user)?->delete();

        $web = $this->auth->guard('web');

        if ($web instanceof SessionGuard && $web->hasUser() && $request->hasSession()) {
            $this->sessions->forgetCurrent($request);
            $web->logoutCurrentDevice();
            $request->session()->invalidate();
        }
    }
}
