<?php

declare(strict_types=1);

namespace App\Core\Http\Controllers;

use App\Core\Http\ApiResponse;
use Illuminate\Http\JsonResponse;

final class HealthController
{
    /**
     * Liveness probe.
     *
     * @unauthenticated
     */
    public function __invoke(): JsonResponse
    {
        return ApiResponse::success(['status' => 'ok']);
    }
}
