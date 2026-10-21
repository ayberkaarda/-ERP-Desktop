<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Enums;

enum PriceSource: string
{
    case PartyPriceList = 'party_price_list';
    case DefaultPriceList = 'default_price_list';
    case None = 'none';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $c): string => $c->value, self::cases());
    }
}
