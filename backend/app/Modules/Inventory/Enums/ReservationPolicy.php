<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Enums;

/**
 * none: the warehouse takes no reservations; soft: reservations beyond availability are kept and reported; hard: they are refused and issues may not take reserved stock.
 */
enum ReservationPolicy: string
{
    case None = 'none';
    case Soft = 'soft';
    case Hard = 'hard';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $c): string => $c->value, self::cases());
    }
}
