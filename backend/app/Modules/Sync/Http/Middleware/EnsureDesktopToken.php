<?php

declare(strict_types=1);

namespace App\Modules\Sync\Http\Middleware;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use Closure;
use Illuminate\Http\Request;
use Laravel\Sanctum\PersonalAccessToken;
use Symfony\Component\HttpFoundation\Response;

/**
 * Sync endpoints serve desktop device tokens only: a Sanctum token that names the `desktop`
 * ability explicitly. Browser sessions and wildcard (`*`) tokens get 403 FORBIDDEN.
 */
final class EnsureDesktopToken
{
    public const string ABILITY = 'desktop';

    /** Request attribute holding the id of the desktop token that passed. */
    public const string TOKEN_ATTRIBUTE = 'sync.token_id';

    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->user()?->currentAccessToken();

        if (! $token instanceof PersonalAccessToken || ! in_array(self::ABILITY, $token->abilities ?? [], true)) {
            throw new ApiException(ErrorCode::Forbidden);
        }

        $request->attributes->set(self::TOKEN_ATTRIBUTE, (string) $token->getKey());

        /** @var Response */
        return $next($request);
    }
}
