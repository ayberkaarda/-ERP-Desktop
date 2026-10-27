<?php

declare(strict_types=1);

return [
    // Wire format of /sync/*; the server accepts clients from min_schema_version up.
    'schema_version' => (int) env('SYNC_SCHEMA_VERSION', 1),
    'min_schema_version' => (int) env('SYNC_MIN_SCHEMA_VERSION', 1),

    // Source of truth for resources, write rules and limits served by GET /sync/manifest.
    'manifest_path' => env('SYNC_MANIFEST_PATH', base_path('../contracts/offline-manifest.json')),

    'push' => ['lock_timeout_ms' => (int) env('SYNC_PUSH_LOCK_TIMEOUT_MS', 2000)],

    'limits' => [
        'pull_resources_max' => (int) env('SYNC_PULL_RESOURCES_MAX', 32),
        'pull_page_default' => (int) env('SYNC_PULL_PAGE_DEFAULT', 200),
        'pull_page_max' => (int) env('SYNC_PULL_PAGE_MAX', 1000),
        'push_batch_max' => (int) env('SYNC_PUSH_BATCH_MAX', 200),
    ],

    // Server-side protection of /sync/*, not part of the manifest: requests per minute per device
    // token and per user (429 TOO_MANY_ATTEMPTS with Retry-After), and pulls running at once.
    'throttle' => [
        'device_per_minute' => (int) env('SYNC_THROTTLE_DEVICE_PER_MINUTE', 120),
        'user_per_minute' => (int) env('SYNC_THROTTLE_USER_PER_MINUTE', 300),
        'concurrent_pulls_per_device' => (int) env('SYNC_CONCURRENT_PULLS_PER_DEVICE', 1),
        'concurrent_pulls_per_user' => (int) env('SYNC_CONCURRENT_PULLS_PER_USER', 3),
        // Upper bound of one pull; a slot of a crashed worker frees itself after this.
        'pull_slot_seconds' => (int) env('SYNC_PULL_SLOT_SECONDS', 120),
    ],

    // Tombstones older than this are pruned; pruning raises the tombstone floor.
    'tombstone_retention_days' => (int) env('SYNC_TOMBSTONE_RETENTION_DAYS', 90),

    // Push results are replayable per mutation key for this long (scope 'sync.push').
    'idempotency_retention_days' => (int) env('SYNC_IDEMPOTENCY_RETENTION_DAYS', 7),
];
