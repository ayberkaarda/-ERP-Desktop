<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports;

use App\Modules\Accounting\Reports\Policies\ReportPolicy;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\ServiceProvider;

/**
 * Accounting reports (registered by AccountingServiceProvider; routes come from Reports/routes.php).
 */
final class ReportsServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Gate::define(ReportPolicy::ABILITY, [ReportPolicy::class, 'view']);
    }
}
