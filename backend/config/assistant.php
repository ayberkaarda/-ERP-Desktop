<?php

declare(strict_types=1);

return [
    'enabled' => (bool) env('ASSISTANT_ENABLED', false),
    'provider' => env('ASSISTANT_PROVIDER'),
    'model' => env('ASSISTANT_MODEL'),
    'max_steps' => (int) env('ASSISTANT_MAX_STEPS', 4),
    'max_output_tokens' => (int) env('ASSISTANT_MAX_OUTPUT_TOKENS', 2048),
    'daily_tokens' => (int) env('ASSISTANT_DAILY_TOKENS', 1000000),
    'turn_tokens' => (int) env('ASSISTANT_TURN_TOKENS', 200000),
    'max_input_chars' => 6000,
    'max_history_chars' => 24000,
    'max_output_chars' => 16000,
    'requests_per_minute' => 10,
    'mask_pii' => (bool) env('ASSISTANT_MASK_PII', true),
    'retention_days' => (int) env('ASSISTANT_RETENTION_DAYS', 30),
    'timeout' => 90,
    'lease_seconds' => 1800,
];
