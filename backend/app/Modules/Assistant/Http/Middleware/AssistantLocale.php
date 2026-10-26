<?php

declare(strict_types=1);

namespace App\Modules\Assistant\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class AssistantLocale
{
    public function handle(Request $request, Closure $next): Response
    {
        $previous = app()->getLocale();
        $preferred = $request->hasHeader('Accept-Language') ? $request->getPreferredLanguage(['tr', 'en', 'de', 'fr']) : $request->user()?->getAttribute('locale');
        app()->setLocale(in_array($preferred, ['tr', 'en', 'de', 'fr'], true) ? $preferred : 'en');
        try {
            return $next($request);
        } finally {
            app()->setLocale($previous);
        }
    }
}
