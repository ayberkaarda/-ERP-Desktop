<?php

declare(strict_types=1);

namespace App\Core\Sync\Rules;

use App\Core\Sync\Mutation;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Support\Facades\DB;

/**
 * A client-generated primary key for a new row of $table: a lowercase canonical UUIDv7
 * (ADR 0002) that no row of the table holds yet, in any company and soft deleted or not.
 *
 * Keys are global, so a key taken in another company cannot be used either. Every failure -
 * malformed, not v7, taken here, taken elsewhere - answers the same message(), so the answer
 * does not tell which one it was. What stays observable is that a known valid key is refused;
 * UUIDv7 keys cannot be guessed, the request needs the create permission, and /sync is rate
 * limited. The insert races that slip past this check answer message() too.
 */
final class ClientKey implements ValidationRule
{
    public function __construct(private readonly string $table) {}

    public static function message(): string
    {
        return (string) __('core::sync.client_key_unusable');
    }

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value) || preg_match(Mutation::UUID7_PATTERN, $value) !== 1
            || DB::table($this->table)->where('id', $value)->exists()) {
            $fail(self::message());
        }
    }
}
