<?php

declare(strict_types=1);

use App\Modules\Catalog\Http\Controllers\DiscountRuleController;
use App\Modules\Catalog\Http\Controllers\ItemBarcodeController;
use App\Modules\Catalog\Http\Controllers\ItemCategoryController;
use App\Modules\Catalog\Http\Controllers\ItemController;
use App\Modules\Catalog\Http\Controllers\ItemUnitController;
use App\Modules\Catalog\Http\Controllers\ItemVariantController;
use App\Modules\Catalog\Http\Controllers\PriceListController;
use App\Modules\Catalog\Http\Controllers\PriceListLineController;
use App\Modules\Catalog\Http\Controllers\PricingController;
use App\Modules\Catalog\Http\Controllers\UnitController;
use App\Modules\Catalog\Http\Controllers\UnitConversionController;
use Illuminate\Support\Facades\Route;

// Loaded under api/v1 with the `api` group by ModuleServiceProvider.

Route::middleware(['auth:sanctum', 'password.changed', 'company'])->group(function (): void {
    $crud = static function (string $uri, string $controller, string $param = 'id'): void {
        Route::get($uri, [$controller, 'index']);
        Route::post($uri, [$controller, 'store'])->middleware('idempotent');
        Route::get("{$uri}/{{$param}}", [$controller, 'show'])->whereUuid($param);
        Route::patch("{$uri}/{{$param}}", [$controller, 'update'])->whereUuid($param);
        Route::delete("{$uri}/{{$param}}", [$controller, 'destroy'])->whereUuid($param);
    };

    Route::get('units/convert', [UnitConversionController::class, 'convert']);
    $crud('units', UnitController::class);
    $crud('unit-conversions', UnitConversionController::class);
    $crud('item-categories', ItemCategoryController::class);
    $crud('items', ItemController::class);

    Route::prefix('items/{item}')->whereUuid('item')->group(function () use ($crud): void {
        $crud('variants', ItemVariantController::class);
        $crud('barcodes', ItemBarcodeController::class);
        $crud('units', ItemUnitController::class);
    });

    $crud('price-lists', PriceListController::class);

    Route::prefix('price-lists/{priceList}')->whereUuid('priceList')->group(function () use ($crud): void {
        Route::put('lines', [PriceListLineController::class, 'bulk']);
        $crud('lines', PriceListLineController::class);
    });

    $crud('discount-rules', DiscountRuleController::class);

    Route::get('pricing/resolve', [PricingController::class, 'resolvePrice']);
});
