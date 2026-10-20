<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Route;

Route::get('/_demo/ping', fn () => ['data' => __('demo::messages.pong')]);
