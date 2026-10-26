<?php

declare(strict_types=1);

namespace App\Modules\Sync;

use App\Core\Modules\ModuleServiceProvider;
use App\Modules\Sync\Console\PruneCommand;
use Illuminate\Console\Scheduling\Schedule;

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

        if ($this->app->runningInConsole()) {
            $this->commands([PruneCommand::class]);
            $this->callAfterResolving(Schedule::class, static function (Schedule $schedule): void {
                $schedule->command('sync:prune')->daily()->withoutOverlapping();
            });
        }
    }
}
