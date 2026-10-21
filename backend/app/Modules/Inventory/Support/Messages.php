<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Support;

use Illuminate\Validation\ValidationException;

final class Messages
{
    /**
     * @param  array<string, string|int|float>  $replace
     */
    public static function get(string $key, array $replace = []): string
    {
        $text = __("inventory::messages.{$key}", $replace);

        return is_string($text) ? $text : $key;
    }

    /**
     * 422 with the message on one field.
     *
     * @param  array<string, string|int|float>  $replace
     *
     * @throws ValidationException
     */
    public static function fail(string $field, string $key, array $replace = []): never
    {
        throw ValidationException::withMessages([$field => [self::get($key, $replace)]]);
    }
}
