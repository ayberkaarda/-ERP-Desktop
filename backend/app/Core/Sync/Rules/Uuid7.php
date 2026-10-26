<?php

declare(strict_types=1);

namespace App\Core\Sync\Rules;

use App\Core\Sync\Mutation;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * Client-generated primary keys must be lowercase canonical UUIDv7 (ADR 0002), so they stay
 * time ordered like the keys the server generates.
 */
final class Uuid7 implements ValidationRule
{
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value) || preg_match(Mutation::UUID7_PATTERN, $value) !== 1) {
            $fail('validation.uuid')->translate();
        }
    }
}
