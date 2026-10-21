<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Enums;

enum ItemTracking: string
{
    case None = 'none';
    case Lot = 'lot';
    case Serial = 'serial';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $c): string => $c->value, self::cases());
    }
}
