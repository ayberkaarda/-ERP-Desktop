<?php

declare(strict_types=1);

use App\Modules\EDocuments\Http\Controllers\DocumentController as C;
use App\Modules\EDocuments\Http\Middleware\AuthorizeEDocument;
use App\Modules\EDocuments\Http\Middleware\OperationIdempotency;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', 'password.changed', 'company'])->prefix('e-documents')->group(function (): void {
    Route::get('status', [C::class, 'status']);
    Route::middleware(AuthorizeEDocument::class)->group(function (): void {
        Route::get('documents', [C::class, 'index']);
        Route::get('sources', [C::class, 'sources']);
        Route::get('taxpayers', [C::class, 'taxpayers']);
        Route::get('documents/{id}', [C::class, 'show'])->whereUuid('id');
        Route::get('documents/{id}/xml', [C::class, 'download'])->whereUuid('id');
        Route::middleware(OperationIdempotency::class)->group(function (): void {
            Route::post('documents', [C::class, 'store']);
            Route::patch('documents/{id}', [C::class, 'update'])->whereUuid('id');
            foreach (['validate' => 'validateDocument', 'send' => 'send', 'retry' => 'retry', 'poll' => 'poll', 'respond' => 'respond', 'link-purchase' => 'linkPurchase', 'cancel' => 'cancel'] as $path => $action) {
                Route::post('documents/{id}/'.$path, [C::class, $action])->whereUuid('id');
            }
            Route::post('inbox/import', [C::class, 'import']);
            Route::post('inbox/poll', [C::class, 'pollInbox']);
            Route::post('sandbox/taxpayers', [C::class, 'saveTaxpayer']);
            Route::post('sandbox/inbox', [C::class, 'stageInbox']);
            Route::post('sandbox/documents/{id}/outcome', [C::class, 'setOutcome'])->whereUuid('id');
        });
    });
});
