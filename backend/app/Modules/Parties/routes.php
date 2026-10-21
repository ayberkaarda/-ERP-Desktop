<?php

declare(strict_types=1);

use App\Modules\Parties\Http\Controllers\PartyAddressController;
use App\Modules\Parties\Http\Controllers\PartyBankAccountController;
use App\Modules\Parties\Http\Controllers\PartyContactController;
use App\Modules\Parties\Http\Controllers\PartyController;
use Illuminate\Support\Facades\Route;

// Loaded under api/v1 with the `api` group by ModuleServiceProvider.

Route::middleware(['auth:sanctum', 'password.changed', 'company'])->group(function (): void {
    Route::get('parties', [PartyController::class, 'index'])->name('parties.index');
    Route::post('parties', [PartyController::class, 'store'])->middleware('idempotent')->name('parties.store');
    Route::get('parties/duplicates', [PartyController::class, 'duplicates'])->name('parties.duplicates');
    Route::get('parties/export', [PartyController::class, 'export'])->name('parties.export');

    Route::prefix('parties/{party}')->whereUuid('party')->group(function (): void {
        Route::get('/', [PartyController::class, 'show'])->name('parties.show');
        Route::patch('/', [PartyController::class, 'update'])->name('parties.update');
        Route::delete('/', [PartyController::class, 'destroy'])->name('parties.destroy');

        $children = [
            'addresses' => PartyAddressController::class,
            'contacts' => PartyContactController::class,
            'bank-accounts' => PartyBankAccountController::class,
        ];

        foreach ($children as $path => $controller) {
            Route::get($path, [$controller, 'index'])->name("parties.{$path}.index");
            Route::post($path, [$controller, 'store'])->middleware('idempotent')->name("parties.{$path}.store");
            Route::get("{$path}/{child}", [$controller, 'show'])->whereUuid('child')->name("parties.{$path}.show");
            Route::patch("{$path}/{child}", [$controller, 'update'])->whereUuid('child')->name("parties.{$path}.update");
            Route::delete("{$path}/{child}", [$controller, 'destroy'])->whereUuid('child')->name("parties.{$path}.destroy");
        }
    });
});
