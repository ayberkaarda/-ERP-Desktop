<?php

declare(strict_types=1);

use App\Modules\Treasury\Banking\Http\Controllers\BankStatementController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', 'password.changed', 'company'])->prefix('treasury-bank-statements')->group(function (): void {
    Route::get('/', [BankStatementController::class, 'index']);
    Route::post('preview', [BankStatementController::class, 'preview']);
    Route::post('/', [BankStatementController::class, 'store'])->middleware('idempotent');
    Route::get('{id}', [BankStatementController::class, 'show'])->whereUuid('id');
    Route::get('{id}/suggestions', [BankStatementController::class, 'suggestions'])->whereUuid('id');
    foreach (['match', 'unmatch', 'reconcile', 'reopen'] as $action) {
        Route::post("{id}/{$action}", [BankStatementController::class, 'action'])->whereUuid('id')->defaults('action', $action)->middleware('idempotent');
    }
});
