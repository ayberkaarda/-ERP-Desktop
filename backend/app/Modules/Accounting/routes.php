<?php

declare(strict_types=1);

use App\Modules\Accounting\Http\Controllers\AccountController;
use App\Modules\Accounting\Http\Controllers\AccountingPeriodController;
use App\Modules\Accounting\Http\Controllers\DeterminationRuleController;
use App\Modules\Accounting\Http\Controllers\FiscalYearController;
use App\Modules\Accounting\Http\Controllers\FxRevaluationController;
use App\Modules\Accounting\Http\Controllers\JournalEntryController;
use Illuminate\Support\Facades\Route;

// Loaded under api/v1 with the `api` group by ModuleServiceProvider.

Route::middleware(['auth:sanctum', 'password.changed', 'company'])->group(function (): void {
    Route::get('fiscal-years', [FiscalYearController::class, 'index']);
    Route::post('fiscal-years', [FiscalYearController::class, 'store'])->middleware('idempotent');
    Route::get('fiscal-years/{id}', [FiscalYearController::class, 'show'])->whereUuid('id');
    Route::patch('fiscal-years/{id}', [FiscalYearController::class, 'update'])->whereUuid('id');
    Route::post('fiscal-years/{id}/close', [FiscalYearController::class, 'close'])->whereUuid('id');
    Route::post('fiscal-years/{id}/reopen', [FiscalYearController::class, 'reopen'])->whereUuid('id');

    Route::get('accounting-periods', [AccountingPeriodController::class, 'index']);
    Route::get('accounting-periods/{id}', [AccountingPeriodController::class, 'show'])->whereUuid('id');
    Route::post('accounting-periods/{id}/soft-close', [AccountingPeriodController::class, 'softClose'])->whereUuid('id');
    Route::post('accounting-periods/{id}/close', [AccountingPeriodController::class, 'close'])->whereUuid('id');
    Route::post('accounting-periods/{id}/reopen', [AccountingPeriodController::class, 'reopen'])->whereUuid('id');

    Route::get('accounts', [AccountController::class, 'index']);
    Route::get('accounts/tree', [AccountController::class, 'tree']);
    Route::post('accounts/import', [AccountController::class, 'import'])->middleware('idempotent');
    Route::post('accounts', [AccountController::class, 'store'])->middleware('idempotent');
    Route::get('accounts/{id}', [AccountController::class, 'show'])->whereUuid('id');
    Route::get('accounts/{id}/balance', [AccountController::class, 'balance'])->whereUuid('id');
    Route::patch('accounts/{id}', [AccountController::class, 'update'])->whereUuid('id');
    Route::delete('accounts/{id}', [AccountController::class, 'destroy'])->whereUuid('id');

    Route::get('journal-entries', [JournalEntryController::class, 'index']);
    Route::get('journal-entries/export', [JournalEntryController::class, 'export']);
    Route::post('journal-entries', [JournalEntryController::class, 'store'])->middleware('idempotent');
    Route::get('journal-entries/{id}', [JournalEntryController::class, 'show'])->whereUuid('id');
    Route::patch('journal-entries/{id}', [JournalEntryController::class, 'update'])->whereUuid('id');
    Route::delete('journal-entries/{id}', [JournalEntryController::class, 'destroy'])->whereUuid('id');
    Route::post('journal-entries/{id}/post', [JournalEntryController::class, 'post'])->whereUuid('id')->middleware('idempotent');
    Route::post('journal-entries/{id}/reverse', [JournalEntryController::class, 'reverse'])->whereUuid('id')->middleware('idempotent');

    Route::get('account-determination-rules', [DeterminationRuleController::class, 'index']);
    Route::post('account-determination-rules', [DeterminationRuleController::class, 'store'])->middleware('idempotent');
    Route::get('account-determination-rules/{id}', [DeterminationRuleController::class, 'show'])->whereUuid('id');
    Route::patch('account-determination-rules/{id}', [DeterminationRuleController::class, 'update'])->whereUuid('id');
    Route::delete('account-determination-rules/{id}', [DeterminationRuleController::class, 'destroy'])->whereUuid('id');
    Route::post('account-determination/test', [DeterminationRuleController::class, 'test']);

    Route::post('fx-revaluations', [FxRevaluationController::class, 'store'])->middleware('idempotent');
});

// Report endpoints live in Reports/ (own routes file) and use the same stack there.
if (is_file(__DIR__.'/Reports/routes.php')) {
    require __DIR__.'/Reports/routes.php';
}
