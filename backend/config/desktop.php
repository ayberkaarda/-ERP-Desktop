<?php

declare(strict_types=1);

return [
    'version' => env('APP_VERSION', '0.1.0'),
    'api_version' => 'v1',
    'min_version' => env('DESKTOP_MIN_VERSION', '0.1.0'),
    'update_channel' => env('DESKTOP_UPDATE_CHANNEL', 'stable'),
    'schema_version' => (int) env('SYNC_SCHEMA_VERSION', 1),
    'min_schema_version' => (int) env('SYNC_MIN_SCHEMA_VERSION', 1),
];
