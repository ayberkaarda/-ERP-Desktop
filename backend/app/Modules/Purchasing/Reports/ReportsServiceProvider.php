<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Reports;

use App\Modules\Purchasing\Reports\Policies\PurchaseReportPolicy;
use App\Modules\Purchasing\Reports\Services\ItemDirectory;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\ServiceProvider;

/**
 * Purchasing reports (registered by PurchasingServiceProvider; routes come from Reports/routes.php).
 */
final class ReportsServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // One memo of item/supplier details per request, shared by the fact streams and the decorators.
        $this->app->scoped(ItemDirectory::class);
    }

    public function boot(): void
    {
        Gate::define(PurchaseReportPolicy::ABILITY, [PurchaseReportPolicy::class, 'view']);
    }
}
