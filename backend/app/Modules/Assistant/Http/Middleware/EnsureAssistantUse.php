<?php

declare(strict_types=1);

namespace App\Modules\Assistant\Http\Middleware;

use App\Models\User;
use App\Modules\Assistant\Services\AssistantAccess;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class EnsureAssistantUse
{
    public function handle(Request $request, Closure $next): Response
    {
        $actor = $request->user();
        abort_unless($actor instanceof User, 401);
        app(AssistantAccess::class)->authorize($actor);

        return $next($request);
    }
}
