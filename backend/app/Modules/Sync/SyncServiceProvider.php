<?php

declare(strict_types=1);

namespace App\Modules\Sync;

use App\Core\Modules\ModuleServiceProvider;
use App\Modules\Identity\Events\MembershipRevoked;
use App\Modules\Sync\Console\PruneCommand;
use App\Modules\Sync\Services\Visibility;
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

        // Identity has no event for role or permission changes yet (P8); membership loss is
        // the one visibility change it announces.
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
