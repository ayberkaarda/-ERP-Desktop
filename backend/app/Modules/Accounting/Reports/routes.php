<?php

declare(strict_types=1);

use App\Modules\Accounting\Reports\Http\Controllers\ReportController;
use Illuminate\Support\Facades\Route;

// Required by the Accounting routes.php, so these load under api/v1 with the `api` group as well.

Route::middleware(['auth:sanctum', 'password.changed', 'company'])->prefix('reports')->group(function (): void {
    Route::get('trial-balance', [ReportController::class, 'trialBalance']);
    Route::get('trial-balance/export', [ReportController::class, 'trialBalanceExport']);
    Route::get('general-ledger', [ReportController::class, 'generalLedger']);
    Route::get('general-ledger/export', [ReportController::class, 'generalLedgerExport']);
    Route::get('journal-book', [ReportController::class, 'journalBook']);
    Route::get('journal-book/export', [ReportController::class, 'journalBookExport']);
    Route::get('account-statement', [ReportController::class, 'accountStatement']);
    Route::get('account-statement/export', [ReportController::class, 'accountStatementExport']);
});
