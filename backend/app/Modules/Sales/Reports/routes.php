<?php

declare(strict_types=1);

use App\Modules\Sales\Reports\Http\Controllers\SalesReportController;
use App\Modules\Sales\Reports\Http\Requests\SalesReportRequest;
use Illuminate\Support\Facades\Route;

// Required by the module routes.php (prefix api/v1, middleware api).

Route::middleware(['auth:sanctum', 'password.changed', 'company'])->prefix('sales-reports')->group(function (): void {
    foreach (SalesReportRequest::reports() as $report) {
        Route::get($report, [SalesReportController::class, 'show'])->defaults('report', $report);
        Route::get("{$report}/export", [SalesReportController::class, 'export'])->defaults('report', $report);
    }
});
