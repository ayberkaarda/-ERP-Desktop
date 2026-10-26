<?php

declare(strict_types=1);

namespace App\Modules\Sales\Reports;

use App\Modules\Sales\Reports\Policies\SalesReportPolicy;
use App\Modules\Sales\Reports\Services\ItemDirectory;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\ServiceProvider;

/**
 * Sales reports (registered by SalesServiceProvider; routes come from Reports/routes.php).
 */
final class ReportsServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // One memo of item/party details per request, shared by the fact streams and the decorators.
        $this->app->scoped(ItemDirectory::class);
    }

    public function boot(): void
    {
        Gate::define(SalesReportPolicy::ABILITY, [SalesReportPolicy::class, 'view']);
    }
}
