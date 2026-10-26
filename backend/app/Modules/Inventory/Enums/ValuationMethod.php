<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Enums;

enum ValuationMethod: string
{
    case MovingAverage = 'moving_average';
    case Fifo = 'fifo';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $c): string => $c->value, self::cases());
    }
}
