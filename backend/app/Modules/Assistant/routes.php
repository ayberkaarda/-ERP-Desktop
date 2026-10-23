<?php

declare(strict_types=1);

use App\Modules\Assistant\Http\Controllers\AssistantController;
use App\Modules\Assistant\Http\Middleware\AssistantLocale;
use App\Modules\Assistant\Http\Middleware\EnsureAssistantEnabled;
use App\Modules\Assistant\Http\Middleware\EnsureAssistantUse;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', 'password.changed', 'company', AssistantLocale::class])->prefix('assistant')->group(function (): void {
    Route::get('status', [AssistantController::class, 'status']);
    Route::middleware(EnsureAssistantEnabled::class)->group(function (): void {
        Route::middleware(EnsureAssistantUse::class)->group(function (): void {
            Route::get('conversations', [AssistantController::class, 'index']);
            Route::post('conversations', [AssistantController::class, 'store'])->middleware('idempotent');
            Route::get('conversations/{id}', [AssistantController::class, 'show'])->whereUuid('id');
            Route::post('conversations/{id}/messages', [AssistantController::class, 'message'])->whereUuid('id')->middleware('throttle:assistant');
            Route::post('conversations/{id}/approvals/{callId}', [AssistantController::class, 'decide'])->whereUuid(['id', 'callId'])->middleware('idempotent');
        });
        Route::get('usage', [AssistantController::class, 'usage']);
    });
});
