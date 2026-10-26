<?php

declare(strict_types=1);

namespace App\Modules\Assistant;

use App\Core\Idempotency\EnsureIdempotency;
use App\Core\Modules\ModuleServiceProvider;
use App\Modules\Assistant\Console\PruneConversations;
use App\Modules\Assistant\Contracts\ToolExecutionContext;
use App\Modules\Assistant\Http\Middleware\AssistantLocale;
use App\Modules\Assistant\Http\Middleware\EnsureAssistantEnabled;
use App\Modules\Assistant\Http\Middleware\EnsureAssistantUse;
use App\Modules\Assistant\Services\ToolAudit;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Contracts\Http\Kernel as HttpKernel;
use Illuminate\Foundation\Http\Kernel;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Ai\Events\InvokingTool;
use Laravel\Ai\Events\ToolFailed;
use Laravel\Ai\Events\ToolInvoked;

final class AssistantServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->scoped(ToolExecutionContext::class);
        $this->app->scoped(ToolAudit::class);
    }

    public function boot(): void
    {
        $this->bootModule();
        $this->callAfterResolving(HttpKernel::class, static function (HttpKernel $kernel): void {
            if ($kernel instanceof Kernel) {
                $kernel->addToMiddlewarePriorityBefore(EnsureIdempotency::class, EnsureAssistantUse::class);
                $kernel->addToMiddlewarePriorityBefore(EnsureAssistantUse::class, EnsureAssistantEnabled::class);
                $kernel->addToMiddlewarePriorityBefore(EnsureAssistantEnabled::class, AssistantLocale::class);
            }
        });
        Event::listen(InvokingTool::class, static fn (InvokingTool $event) => app(ToolAudit::class)->invoking($event));
        Event::listen(ToolInvoked::class, static fn (ToolInvoked $event) => app(ToolAudit::class)->invoked($event));
        Event::listen(ToolFailed::class, static fn (ToolFailed $event) => app(ToolAudit::class)->failed($event));
        RateLimiter::for('assistant', static fn (Request $request): Limit => Limit::perMinute((int) config('assistant.requests_per_minute', 10))->by((string) $request->user()?->getAuthIdentifier()));
        if ($this->app->runningInConsole()) {
            $this->commands([PruneConversations::class]);
            $this->callAfterResolving(Schedule::class, static function (Schedule $schedule): void {
                $schedule->command('assistant:prune')->daily()->withoutOverlapping();
            });
        }
    }
}
