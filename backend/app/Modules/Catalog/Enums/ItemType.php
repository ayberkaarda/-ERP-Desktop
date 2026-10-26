<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Enums;

enum ItemType: string
{
    case Stock = 'stock';
    case Service = 'service';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $c): string => $c->value, self::cases());
    }
}
