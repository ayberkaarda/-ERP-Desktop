<?php

declare(strict_types=1);

return [
    // Wire format of /sync/*; the server accepts clients from min_schema_version up.
    'schema_version' => (int) env('SYNC_SCHEMA_VERSION', 1),
    'min_schema_version' => (int) env('SYNC_MIN_SCHEMA_VERSION', 1),

    // Source of truth for resources, write rules and limits served by GET /sync/manifest.
    'manifest_path' => env('SYNC_MANIFEST_PATH', base_path('../contracts/offline-manifest.json')),

    'limits' => [
        'pull_resources_max' => (int) env('SYNC_PULL_RESOURCES_MAX', 32),
        'pull_page_default' => (int) env('SYNC_PULL_PAGE_DEFAULT', 200),
        'pull_page_max' => (int) env('SYNC_PULL_PAGE_MAX', 1000),
        'push_batch_max' => (int) env('SYNC_PUSH_BATCH_MAX', 200),
    ],

    // Tombstones older than this are pruned; pruning raises the tombstone floor.
    'tombstone_retention_days' => (int) env('SYNC_TOMBSTONE_RETENTION_DAYS', 90),

    // Push results are replayable per mutation key for this long (scope 'sync.push').
    'idempotency_retention_days' => (int) env('SYNC_IDEMPOTENCY_RETENTION_DAYS', 7),
];
