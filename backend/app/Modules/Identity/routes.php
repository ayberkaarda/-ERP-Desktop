<?php

declare(strict_types=1);

use App\Modules\Identity\Http\Controllers\AuditLogController;
use App\Modules\Identity\Http\Controllers\AuthController;
use App\Modules\Identity\Http\Controllers\DeviceController;
use App\Modules\Identity\Http\Controllers\PasswordController;
use App\Modules\Identity\Http\Controllers\PermissionController;
use App\Modules\Identity\Http\Controllers\RoleController;
use App\Modules\Identity\Http\Controllers\SessionController;
use App\Modules\Identity\Http\Controllers\SessionLogController;
use App\Modules\Identity\Http\Controllers\TwoFactorController;
use App\Modules\Identity\Http\Controllers\UserController;
use Illuminate\Support\Facades\Route;

// Loaded under api/v1 with the `api` group by ModuleServiceProvider.

Route::prefix('auth')->group(function (): void {
    Route::post('login', [AuthController::class, 'login'])->name('auth.login');
    Route::post('two-factor/verify', [AuthController::class, 'verifyTwoFactor'])->name('auth.two-factor.verify');
    Route::post('device', [DeviceController::class, 'login'])->name('auth.device');
    Route::post('device/refresh', [DeviceController::class, 'refresh'])->middleware('throttle:20,1')->name('auth.device.refresh');

    Route::middleware('auth:sanctum')->group(function (): void {
        Route::post('logout', [AuthController::class, 'logout'])->name('auth.logout');
        Route::get('me', [AuthController::class, 'me'])->name('auth.me');
        Route::post('password/change', [PasswordController::class, 'change'])->name('auth.password.change');

        Route::middleware('password.changed')->group(function (): void {
            Route::post('two-factor/setup', [TwoFactorController::class, 'setup'])->name('auth.two-factor.setup');
            Route::post('two-factor/confirm', [TwoFactorController::class, 'confirm'])->name('auth.two-factor.confirm');
            Route::delete('two-factor', [TwoFactorController::class, 'disable'])->name('auth.two-factor.disable');
            Route::get('sessions', [SessionController::class, 'index'])->name('auth.sessions.index');
            Route::delete('sessions/{id}', [SessionController::class, 'destroy'])->whereUuid('id')->name('auth.sessions.destroy');
        });
    });
});

Route::middleware(['auth:sanctum', 'password.changed'])->group(function (): void {
    Route::get('me/devices', [DeviceController::class, 'index'])->name('me.devices.index');
    Route::delete('me/devices/{id}', [DeviceController::class, 'destroy'])->whereUuid('id')->name('me.devices.destroy');

    // Company named in the body, not the header.
    Route::put('users/{id}/roles', [UserController::class, 'roles'])->whereUuid('id')->name('users.roles');

    Route::middleware('company')->group(function (): void {
        Route::get('users', [UserController::class, 'index'])->name('users.index');
        Route::post('users', [UserController::class, 'store'])->middleware('idempotent')->name('users.store');
        Route::get('users/{id}', [UserController::class, 'show'])->whereUuid('id')->name('users.show');
        Route::patch('users/{id}', [UserController::class, 'update'])->whereUuid('id')->name('users.update');
        Route::delete('users/{id}', [UserController::class, 'destroy'])->whereUuid('id')->name('users.destroy');
        Route::patch('users/{id}/status', [UserController::class, 'status'])->whereUuid('id')->name('users.status');
        Route::post('users/{id}/password-reset', [UserController::class, 'resetPassword'])->whereUuid('id')->name('users.password-reset');

        Route::get('roles', [RoleController::class, 'index'])->name('roles.index');
        Route::post('roles', [RoleController::class, 'store'])->middleware('idempotent')->name('roles.store');
        Route::get('roles/{role}', [RoleController::class, 'show'])->whereUuid('role')->name('roles.show');
        Route::patch('roles/{role}', [RoleController::class, 'update'])->whereUuid('role')->name('roles.update');
        Route::delete('roles/{role}', [RoleController::class, 'destroy'])->whereUuid('role')->name('roles.destroy');

        Route::get('permissions', [PermissionController::class, 'index'])->name('permissions.index');

        Route::get('logs/sessions', [SessionLogController::class, 'index'])->name('logs.sessions');
        Route::get('logs/audit', [AuditLogController::class, 'index'])->name('logs.audit');
        Route::get('logs/audit/export', [AuditLogController::class, 'export'])->name('logs.audit.export');
    });
});
