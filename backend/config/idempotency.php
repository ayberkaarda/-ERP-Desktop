<?php

declare(strict_types=1);

return [
    // How long a finished response is replayed for the same key.
    'ttl_hours' => (int) env('IDEMPOTENCY_TTL_HOURS', 24),

    // How long an in-flight request holds its key before a retry may take over.
    'lease_seconds' => (int) env('IDEMPOTENCY_LEASE_SECONDS', 300),
];
