<?php

declare(strict_types=1);

return [
    'lockout' => [
        'max_attempts' => 5,
        'decay_seconds' => 900,
    ],

    'two_factor' => [
        // Pending login challenge lifetime after a correct password.
        'challenge_seconds' => 300,
        'recovery_codes' => 8,
    ],

    'password' => [
        'min_length' => 12,
    ],

    'device_tokens' => [
        // Overridable through sanctum.device_access_ttl_minutes / device_refresh_ttl_days.
        'access_ttl_minutes' => 60,
        'refresh_ttl_days' => 30,
    ],

    'sessions' => [
        // Touch the tracked session row at most this often.
        'touch_seconds' => 60,
    ],

    'audit_export' => [
        'max_rows' => 50000,
    ],
];
