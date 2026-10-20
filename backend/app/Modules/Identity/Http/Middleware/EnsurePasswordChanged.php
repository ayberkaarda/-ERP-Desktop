<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http\Middleware;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Middleware alias `password.changed`: blocks everything until a forced password change is done.
 */
final class EnsurePasswordChanged
{
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user instanceof User && $user->must_change_password) {
            throw new ApiException(ErrorCode::PasswordChangeRequired);
        }

        return $next($request);
    }
}
