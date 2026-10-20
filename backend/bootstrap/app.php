<?php

declare(strict_types=1);

use App\Core\Company\Http\ResolveCompany;
use App\Core\Http\ExceptionRenderer;
use App\Core\Idempotency\EnsureIdempotency;
use Illuminate\Contracts\Auth\Middleware\AuthenticatesRequests;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        apiPrefix: 'api/v1',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->statefulApi();

        $middleware->alias([
            'company' => ResolveCompany::class,
            'idempotent' => EnsureIdempotency::class,
        ]);

        // auth -> company -> idempotent -> bindings, so route model binding is company scoped
        // and idempotency keys are scoped to user + company.
        $middleware->appendToPriorityList(AuthenticatesRequests::class, ResolveCompany::class);
        $middleware->appendToPriorityList(ResolveCompany::class, EnsureIdempotency::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request): bool => ExceptionRenderer::shouldRender($request),
        );
        $exceptions->render(new ExceptionRenderer);
    })->create();
