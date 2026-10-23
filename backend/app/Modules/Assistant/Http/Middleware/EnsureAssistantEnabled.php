<?php

declare(strict_types=1);

namespace App\Modules\Assistant\Http\Middleware;

use App\Modules\Assistant\Services\AssistantAccess;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class EnsureAssistantEnabled
{
    public function handle(Request $request, Closure $next): Response
    {
        app(AssistantAccess::class)->enabled();

        return $next($request);
    }
}
