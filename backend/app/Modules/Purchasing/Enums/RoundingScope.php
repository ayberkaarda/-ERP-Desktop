<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Enums;

/** per_line: tax rounded on every line; per_total: once per tax code and allocated back to the lines. */
enum RoundingScope: string
{
    case PerLine = 'per_line';
    case PerTotal = 'per_total';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $c): string => $c->value, self::cases());
    }
}
