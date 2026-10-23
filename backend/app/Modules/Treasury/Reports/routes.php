<?php

declare(strict_types=1);

use App\Modules\Treasury\Reports\Http\Controllers\TreasuryReportController;
use App\Modules\Treasury\Reports\Services\TreasuryReports;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', 'password.changed', 'company'])->prefix('treasury-reports')->group(function (): void {
    foreach (TreasuryReports::NAMES as $report) {
        Route::get($report, [TreasuryReportController::class, 'show'])->defaults('report', $report);
        Route::get($report.'/export', [TreasuryReportController::class, 'export'])->defaults('report', $report);
    }
});
