<?php

declare(strict_types=1);

use App\Modules\Sync\Http\Controllers\SyncController;
use App\Modules\Sync\Http\Middleware\EnsureDesktopToken;
use App\Modules\Sync\Http\Middleware\LimitConcurrentPulls;
use App\Modules\Sync\SyncServiceProvider;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', EnsureDesktopToken::class, 'throttle:'.SyncServiceProvider::LIMITER, 'password.changed', 'company'])->prefix('sync')->group(function (): void {
    Route::get('/manifest', [SyncController::class, 'manifest']);
    Route::post('/pull', [SyncController::class, 'pull'])->middleware(LimitConcurrentPulls::class);
    Route::post('/push', [SyncController::class, 'push']);
});
