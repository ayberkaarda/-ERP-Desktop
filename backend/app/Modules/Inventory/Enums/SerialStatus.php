<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Enums;

enum SerialStatus: string
{
    case InStock = 'in_stock';
    case Issued = 'issued';
    case Reserved = 'reserved';
    case Scrapped = 'scrapped';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $c): string => $c->value, self::cases());
    }
}
