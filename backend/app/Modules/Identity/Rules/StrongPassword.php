<?php

declare(strict_types=1);

namespace App\Modules\Identity\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * Password policy: at least N characters (12 by default) and not the user's email, its local part or name.
 */
final class StrongPassword implements ValidationRule
{
    public function __construct(
        private readonly ?string $email = null,
        private readonly ?string $name = null,
    ) {}

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value)) {
            $fail('identity::auth.password_policy')->translate();

            return;
        }

        $min = config('identity.password.min_length', 12);
        $min = is_numeric($min) ? (int) $min : 12;

        if (mb_strlen($value) < $min) {
            $fail('identity::auth.password_too_short')->translate(['min' => (string) $min]);

            return;
        }

        $normalized = mb_strtolower(trim($value));
        $forbidden = array_filter([
            $this->email !== null ? mb_strtolower(trim($this->email)) : null,
            $this->email !== null ? mb_strtolower(explode('@', trim($this->email))[0]) : null,
            $this->name !== null ? mb_strtolower(trim($this->name)) : null,
            $this->name !== null ? mb_strtolower(str_replace(' ', '', trim($this->name))) : null,
        ], static fn (?string $v): bool => $v !== null && $v !== '');

        if (in_array($normalized, $forbidden, true)) {
            $fail('identity::auth.password_matches_identity')->translate();
        }
    }
}
