<?php

declare(strict_types=1);

namespace App\Core\Http\Controllers;

use App\Core\Http\ApiResponse;
use Illuminate\Http\JsonResponse;

final class MetaController
{
    /**
     * Public server metadata for desktop clients.
     *
     * @unauthenticated
     */
    public function __invoke(): JsonResponse
    {
        $reverb = config('broadcasting.connections.reverb');

        return ApiResponse::success([
            'name' => config('app.name'),
            'version' => config('desktop.version'),
            'api_version' => config('desktop.api_version'),
            'reverb' => [
                'host' => $reverb['options']['host'] ?? null,
                'port' => isset($reverb['options']['port']) ? (int) $reverb['options']['port'] : null,
                'scheme' => $reverb['options']['scheme'] ?? null,
                'key' => $reverb['key'] ?? null,
            ],
            'desktop' => [
                'min_version' => config('desktop.min_version'),
                'update_channel' => config('desktop.update_channel'),
            ],
            'sync' => [
                'schema_version' => config('desktop.schema_version'),
                'min_schema_version' => config('desktop.min_schema_version'),
            ],
        ]);
    }
}
