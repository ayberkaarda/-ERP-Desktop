<?php

declare(strict_types=1);

namespace App\Modules\Sync;

use App\Core\Modules\ModuleServiceProvider;
use App\Modules\Identity\Events\AccessChanged;
use App\Modules\Identity\Events\MembershipRevoked;
use App\Modules\Sync\Console\PruneCommand;
use App\Modules\Sync\Services\Visibility;
use App\Modules\Sync\Services\VisibilityRefresh;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\Event;

/**
 * Desktop sync server: GET /sync/manifest, POST /sync/pull, POST /sync/push over the module
 * adapters tagged App\Core\Sync\Contracts\SyncResource::TAG / SyncWriter::TAG, and the
 * daily sync:prune of tombstones and push results.
 */
final class SyncServiceProvider extends ModuleServiceProvider
{
    public function boot(): void
    {
        parent::boot();

        // Role, permission and super admin changes, inside their transaction: re-observe the
        // visibility of the users' resources with the new permissions.
        Event::listen(AccessChanged::class, static function (AccessChanged $event): void {
            app(VisibilityRefresh::class)->handle($event);
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
