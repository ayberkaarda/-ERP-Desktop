<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Enums;

/** What a three-way match variance does at booking: nothing, a warning, or a 422 unless overridden. */
enum MatchMode: string
{
    case Off = 'off';
    case Warn = 'warn';
    case Block = 'block';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $c): string => $c->value, self::cases());
    }
}
