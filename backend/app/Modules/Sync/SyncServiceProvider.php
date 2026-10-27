<?php

declare(strict_types=1);

namespace App\Modules\Sync;

use App\Core\Modules\ModuleServiceProvider;
use App\Modules\Identity\Events\AccessChanged;
use App\Modules\Identity\Events\DeviceSignedIn;
use App\Modules\Identity\Events\MembershipRevoked;
use App\Modules\Sync\Console\PruneCommand;
use App\Modules\Sync\Http\Middleware\EnsureDesktopToken;
use App\Modules\Sync\Services\CursorTags;
use App\Modules\Sync\Services\Visibility;
use App\Modules\Sync\Services\VisibilityRefresh;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Desktop sync server: GET /sync/manifest, POST /sync/pull, POST /sync/push over the module
 * adapters tagged App\Core\Sync\Contracts\SyncResource::TAG / SyncWriter::TAG, and the
 * daily sync:prune of tombstones and push results.
 */
final class SyncServiceProvider extends ModuleServiceProvider
{
    public const string LIMITER = 'sync';

    public function register(): void
    {
        $this->app->singleton(CursorTags::class, static fn (): CursorTags => new CursorTags((string) config('app.key')));
    }

    public function boot(): void
    {
        parent::boot();

        // Per device (user_devices.id, kept across token refreshes) and per user (config
        // sync.throttle); 429 TOO_MANY_ATTEMPTS with Retry-After.
        RateLimiter::for(self::LIMITER, static function (Request $request): array {
            $user = (string) $request->user()?->getAuthIdentifier();
            $device = EnsureDesktopToken::device($request) ?? "user:{$user}";

            return [
                Limit::perMinute(max(1, (int) config('sync.throttle.device_per_minute', 120)))->by("sync:device:{$device}"),
                Limit::perMinute(max(1, (int) config('sync.throttle.user_per_minute', 300)))->by("sync:user:{$user}"),
            ];
        });

        // Role, permission and super admin changes, inside their transaction: re-observe the
        // visibility of the users' resources with the new permissions.
        Event::listen(AccessChanged::class, static function (AccessChanged $event): void {
            app(VisibilityRefresh::class)->handle($event);
        });

        Event::listen(DeviceSignedIn::class, static function (DeviceSignedIn $event): void {
            DB::table('sync_full_downloads')->where('device_id', $event->deviceId)->delete();
        });

        // Membership loss (after commit): every cursor of the user in that company is reset.
        Event::listen(MembershipRevoked::class, static function (MembershipRevoked $event): void {
            app(Visibility::class)->invalidate($event->userId, $event->companyId);
        });

        if ($this->app->runningInConsole()) {
            $this->commands([PruneCommand::class]);
            $this->callAfterResolving(Schedule::class, static function (Schedule $schedule): void {
                $schedule->command('sync:prune')->daily()->withoutOverlapping();
            });
        }
    }
}
