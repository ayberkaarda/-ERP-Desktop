<?php

declare(strict_types=1);

namespace App\Modules\Sync\Http\Middleware;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
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

    /**
     * Request attribute holding the durable device (user_devices.id) of that token: it stays the
     * same across token refreshes, so per-device limits are not reset by a refresh. A token
     * without a device row falls back to its own id.
     */
    public const string DEVICE_ATTRIBUTE = 'sync.device_id';

    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->user()?->currentAccessToken();

        if (! $token instanceof PersonalAccessToken || ! in_array(self::ABILITY, $token->abilities ?? [], true)) {
            throw new ApiException(ErrorCode::Forbidden);
        }

        $request->attributes->set(self::TOKEN_ATTRIBUTE, (string) $token->getKey());
        $request->attributes->set(self::DEVICE_ATTRIBUTE, self::device($request));

        /** @var Response */
        return $next($request);
    }

    /**
     * The device key of the request's desktop token (see DEVICE_ATTRIBUTE), or null without one.
     */
    public static function device(Request $request): ?string
    {
        $known = $request->attributes->get(self::DEVICE_ATTRIBUTE);

        if (is_string($known)) {
            return $known;
        }

        $token = $request->user()?->currentAccessToken();

        if (! $token instanceof PersonalAccessToken) {
            return null;
        }

        $device = DB::table('user_devices')->where('token_id', $token->getKey())->value('id');

        return is_string($device) ? $device : 'token:'.(string) $token->getKey();
    }
}
