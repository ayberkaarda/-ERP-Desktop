<?php

declare(strict_types=1);

use App\Modules\Inventory\Http\Controllers\InventoryReportController;
use App\Modules\Inventory\Http\Controllers\ReorderController;
use App\Modules\Inventory\Http\Controllers\ReservationController;
use App\Modules\Inventory\Http\Controllers\StockBalanceController;
use App\Modules\Inventory\Http\Controllers\StockDocumentController;
use App\Modules\Inventory\Http\Controllers\StockMovementController;
use App\Modules\Inventory\Http\Controllers\TraceController;
use App\Modules\Inventory\Http\Controllers\WarehouseController;
use Illuminate\Support\Facades\Route;

// Loaded under api/v1 with the `api` group by ModuleServiceProvider. Warehouse master data and
// locations are Reference's /warehouses endpoints; /stock-warehouses adds the inventory policy.

Route::middleware(['auth:sanctum', 'password.changed', 'company'])->group(function (): void {
    Route::get('stock-warehouses', [WarehouseController::class, 'index']);
    Route::get('stock-warehouses/{id}', [WarehouseController::class, 'show'])->whereUuid('id');
    Route::patch('stock-warehouses/{id}', [WarehouseController::class, 'update'])->whereUuid('id');

    Route::get('stock-documents', [StockDocumentController::class, 'index']);
    Route::get('stock-documents/export', [StockDocumentController::class, 'export']);
    Route::post('stock-documents', [StockDocumentController::class, 'store'])->middleware('idempotent');
    Route::get('stock-documents/{id}', [StockDocumentController::class, 'show'])->whereUuid('id');
    Route::patch('stock-documents/{id}', [StockDocumentController::class, 'update'])->whereUuid('id');
    Route::delete('stock-documents/{id}', [StockDocumentController::class, 'destroy'])->whereUuid('id');
    Route::patch('stock-documents/{id}/counts', [StockDocumentController::class, 'counts'])->whereUuid('id');
    Route::post('stock-documents/{id}/import', [StockDocumentController::class, 'import'])->whereUuid('id')->middleware('idempotent');
    Route::post('stock-documents/{id}/post', [StockDocumentController::class, 'post'])->whereUuid('id')->middleware('idempotent');
    Route::post('stock-documents/{id}/reverse', [StockDocumentController::class, 'reverse'])->whereUuid('id')->middleware('idempotent');

    Route::get('stock-balances', [StockBalanceController::class, 'index']);
    Route::get('stock-balances/export', [StockBalanceController::class, 'export']);
    Route::get('items/{id}/stock', [StockBalanceController::class, 'item'])->whereUuid('id');

    Route::get('stock-movements', [StockMovementController::class, 'index']);
    Route::get('stock-movements/export', [StockMovementController::class, 'export']);

    Route::get('stock-lots', [TraceController::class, 'lots']);
    Route::get('stock-lots/{id}', [TraceController::class, 'lot'])->whereUuid('id');
    Route::get('stock-lots/{id}/trace', [TraceController::class, 'lotTrace'])->whereUuid('id');
    Route::get('stock-serials', [TraceController::class, 'serials']);
    Route::get('stock-serials/{id}', [TraceController::class, 'serial'])->whereUuid('id');

    Route::get('stock-reservations', [ReservationController::class, 'index']);
    Route::post('stock-reservations', [ReservationController::class, 'store'])->middleware('idempotent');
    Route::get('stock-reservations/{id}', [ReservationController::class, 'show'])->whereUuid('id');
    Route::post('stock-reservations/{id}/release', [ReservationController::class, 'release'])->whereUuid('id')->middleware('idempotent');

    Route::get('reports/reorder-suggestions', [ReorderController::class, 'index']);

    // Stock reports (inventory.reports.view), each with an /export?format=csv|xlsx twin.
    Route::prefix('inventory-reports')->group(function (): void {
        foreach ([
            'stock-status' => 'stockStatus', 'stock-ledger' => 'stockLedger', 'valuation' => 'valuation', 'ageing' => 'ageing',
            'expiring-lots' => 'expiringLots', 'abc-analysis' => 'abcAnalysis', 'turnover' => 'turnover', 'movement-summary' => 'movementSummary',
        ] as $path => $action) {
            Route::get($path, [InventoryReportController::class, $action]);
            Route::get($path.'/export', [InventoryReportController::class, $action.'Export']);
        }
    });
});
