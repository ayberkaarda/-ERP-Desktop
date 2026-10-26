<?php

declare(strict_types=1);

use App\Core\Http\Controllers\HealthController;
use App\Core\Http\Controllers\MetaController;
use Illuminate\Support\Facades\Route;

Route::get('/health', HealthController::class)->name('health');
Route::get('/meta', MetaController::class)->name('meta');
