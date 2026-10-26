<?php

declare(strict_types=1);

use App\Modules\Treasury\Http\Controllers\TreasuryCoreController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', 'password.changed', 'company'])->group(function (): void {
    Route::get('treasury-open-items', [TreasuryCoreController::class, 'openItems']);
    foreach (['accounts', 'payments', 'transfers', 'plans'] as $area) {
        $base = $area === 'plans' ? 'treasury-payment-plans' : 'treasury-'.$area;
        Route::get($base, [TreasuryCoreController::class, 'index'])->defaults('area', $area);
        Route::post($base, [TreasuryCoreController::class, 'store'])->defaults('area', $area)->middleware('idempotent');
        Route::get($base.'/{id}', [TreasuryCoreController::class, 'show'])->whereUuid('id')->defaults('area', $area);
        Route::patch($base.'/{id}', [TreasuryCoreController::class, 'update'])->whereUuid('id')->defaults('area', $area);
        Route::delete($base.'/{id}', [TreasuryCoreController::class, 'destroy'])->whereUuid('id')->defaults('area', $area);
        $actions = match ($area) {
            'accounts' => ['opening-balance'],'payments' => ['submit', 'post', 'reverse', 'cancel'],'transfers' => ['post', 'reverse', 'cancel'],default => ['fulfil', 'cancel']
        };
        foreach ($actions as $action) {
            Route::post($base.'/{id}/'.$action, [TreasuryCoreController::class, 'action'])->whereUuid('id')->defaults('area', $area)->defaults('action', $action)->middleware('idempotent');
        }
    }
    Route::get('treasury-accounts/{id}/balance', [TreasuryCoreController::class, 'balance'])->whereUuid('id');
    Route::get('treasury-accounts/{id}/movements', [TreasuryCoreController::class, 'movements'])->whereUuid('id');
    Route::get('treasury-payments/{id}/preview', [TreasuryCoreController::class, 'preview'])->whereUuid('id');
});
