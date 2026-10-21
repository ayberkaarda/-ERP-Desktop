<?php

declare(strict_types=1);

use App\Modules\Reference\Http\Controllers\ExchangeRateController;
use App\Modules\Reference\Http\Controllers\ReferenceController;
use App\Modules\Reference\Services\ReferenceSchema;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', 'password.changed', 'company'])->group(function (): void {
    Route::get('exchange-rates/latest', [ExchangeRateController::class, 'latest']);
    Route::get('exchange-rates/status', [ExchangeRateController::class, 'status']);
    foreach (array_keys(ReferenceSchema::MODELS) as $resource) {
        $prefix = $resource === 'locations' ? 'warehouses/{warehouse}/locations' : $resource;
        Route::get($prefix, [ReferenceController::class, 'index'])->defaults('resource', $resource)->whereUuid('warehouse');
        if ($resource !== 'currencies') {
            Route::post($prefix, [ReferenceController::class, 'store'])->defaults('resource', $resource)->middleware('idempotent')->whereUuid('warehouse');
        }
        Route::get($prefix.'/{id}', [ReferenceController::class, 'show'])->defaults('resource', $resource)->whereUuid(['id', 'warehouse']);
        if ($resource !== 'exchange-rates') {
            Route::patch($prefix.'/{id}', [ReferenceController::class, 'update'])->defaults('resource', $resource)->whereUuid(['id', 'warehouse']);
        }
        if (! in_array($resource, ['currencies', 'exchange-rates'], true)) {
            Route::delete($prefix.'/{id}', [ReferenceController::class, 'destroy'])->defaults('resource', $resource)->whereUuid(['id', 'warehouse']);
        }
    }
});
