<?php

declare(strict_types=1);

use App\Modules\Workflow\Http\Controllers\ApprovalController;
use App\Modules\Workflow\Http\Controllers\ApprovalFlowController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', 'company'])->group(function (): void {
    Route::get('approvals/pending', [ApprovalController::class, 'pending']);
    Route::get('approvals/{id}', [ApprovalController::class, 'show'])->whereUuid('id');
    Route::post('approvals/{id}/decisions', [ApprovalController::class, 'decide'])
        ->whereUuid('id')->middleware('idempotent');
    Route::get('approval-flows', [ApprovalFlowController::class, 'index']);
    Route::post('approval-flows', [ApprovalFlowController::class, 'store'])->middleware('idempotent');
    Route::get('approval-flows/{id}', [ApprovalFlowController::class, 'show'])->whereUuid('id');
    Route::match(['PUT', 'PATCH'], 'approval-flows/{id}', [ApprovalFlowController::class, 'update'])->whereUuid('id');
    Route::delete('approval-flows/{id}', [ApprovalFlowController::class, 'destroy'])->whereUuid('id');
});
