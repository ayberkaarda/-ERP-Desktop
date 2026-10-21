<?php

declare(strict_types=1);

namespace App\Modules\Sales\Enums;

enum CreditCheckMode: string
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
