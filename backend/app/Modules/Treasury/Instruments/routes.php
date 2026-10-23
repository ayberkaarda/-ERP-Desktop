<?php

declare(strict_types=1);

use App\Modules\Treasury\Instruments\Http\Controllers\InstrumentController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', 'password.changed', 'company'])->prefix('treasury-instruments')->group(function (): void {
    Route::get('/', [InstrumentController::class, 'index']);
    Route::post('/', [InstrumentController::class, 'store'])->middleware('idempotent');
    Route::get('{id}', [InstrumentController::class, 'show'])->whereUuid('id');
    Route::patch('{id}', [InstrumentController::class, 'update'])->whereUuid('id');
    Route::delete('{id}', [InstrumentController::class, 'destroy'])->whereUuid('id');
    foreach (['receive', 'issue', 'endorse', 'collect', 'pledge', 'release', 'clear', 'dishonour', 'return'] as $action) {
        Route::post("{id}/{$action}", [InstrumentController::class, 'action'])->whereUuid('id')->defaults('action', $action)->middleware('idempotent');
    }
});
