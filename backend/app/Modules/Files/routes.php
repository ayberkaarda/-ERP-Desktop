<?php

declare(strict_types=1);

use App\Modules\Files\Http\Controllers\FileController;
use App\Modules\Files\Http\ValidateUploadBeforeIdempotency;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', 'password.changed', 'company'])->group(function (): void {
    Route::get('/files', [FileController::class, 'index']);
    Route::post('/files', [FileController::class, 'store'])->middleware([ValidateUploadBeforeIdempotency::class, 'idempotent']);
    Route::get('/files/{id}', [FileController::class, 'show'])->whereUuid('id');
    Route::get('/files/{id}/download', [FileController::class, 'download'])->whereUuid('id');
    Route::delete('/files/{id}', [FileController::class, 'destroy'])->whereUuid('id');
});
