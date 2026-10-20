<?php

declare(strict_types=1);

use App\Modules\Organization\Http\Controllers\BranchController;
use App\Modules\Organization\Http\Controllers\CompanyController;
use App\Modules\Organization\Http\Controllers\DepartmentController;
use Illuminate\Support\Facades\Route;

// Loaded under api/v1 with the `api` group by ModuleServiceProvider.

Route::middleware(['auth:sanctum', 'password.changed'])->group(function (): void {
    Route::get('companies', [CompanyController::class, 'index'])->name('companies.index');
    Route::post('companies', [CompanyController::class, 'store'])->middleware('idempotent')->name('companies.store');
    Route::get('companies/{company}', [CompanyController::class, 'show'])->whereUuid('company')->name('companies.show');
    Route::patch('companies/{company}', [CompanyController::class, 'update'])->whereUuid('company')->name('companies.update');
    Route::delete('companies/{company}', [CompanyController::class, 'destroy'])->whereUuid('company')->name('companies.destroy');

    Route::middleware('company')->group(function (): void {
        Route::prefix('companies/{company}')->whereUuid('company')->group(function (): void {
            Route::get('branches', [BranchController::class, 'index'])->name('branches.index');
            Route::post('branches', [BranchController::class, 'store'])->middleware('idempotent')->name('branches.store');
            Route::get('branches/{branch}', [BranchController::class, 'show'])->whereUuid('branch')->name('branches.show');
            Route::patch('branches/{branch}', [BranchController::class, 'update'])->whereUuid('branch')->name('branches.update');
            Route::delete('branches/{branch}', [BranchController::class, 'destroy'])->whereUuid('branch')->name('branches.destroy');
        });

        Route::get('departments', [DepartmentController::class, 'index'])->name('departments.index');
        Route::post('departments', [DepartmentController::class, 'store'])->middleware('idempotent')->name('departments.store');
        Route::get('departments/{department}', [DepartmentController::class, 'show'])->whereUuid('department')->name('departments.show');
        Route::patch('departments/{department}', [DepartmentController::class, 'update'])->whereUuid('department')->name('departments.update');
        Route::delete('departments/{department}', [DepartmentController::class, 'destroy'])->whereUuid('department')->name('departments.destroy');
    });
});
