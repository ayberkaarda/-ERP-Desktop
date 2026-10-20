<?php

declare(strict_types=1);

return [
    // How long a finished response is replayed for the same key.
    'ttl_hours' => (int) env('IDEMPOTENCY_TTL_HOURS', 24),
];
