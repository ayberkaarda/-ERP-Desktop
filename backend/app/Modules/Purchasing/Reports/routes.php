<?php

declare(strict_types=1);

use App\Modules\Purchasing\Reports\Http\Controllers\PurchaseReportController;
use App\Modules\Purchasing\Reports\Http\Requests\PurchaseReportRequest;
use Illuminate\Support\Facades\Route;

// Required by the module routes.php (prefix api/v1, middleware api).

Route::middleware(['auth:sanctum', 'password.changed', 'company'])->prefix('purchase-reports')->group(function (): void {
    foreach (PurchaseReportRequest::reports() as $report) {
        Route::get($report, [PurchaseReportController::class, 'show'])->defaults('report', $report);
        Route::get("{$report}/export", [PurchaseReportController::class, 'export'])->defaults('report', $report);
    }
});
