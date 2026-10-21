<?php

declare(strict_types=1);

namespace App\Modules\Parties\Support;

final class Messages
{
    /**
     * @param  array<string, string|int>  $replace
     */
    public static function get(string $key, array $replace = []): string
    {
        $text = __(str_contains($key, '::') ? $key : "parties::messages.{$key}", $replace);

        return is_string($text) ? $text : $key;
    }
}
