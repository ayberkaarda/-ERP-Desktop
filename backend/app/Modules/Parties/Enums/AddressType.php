<?php

declare(strict_types=1);

namespace App\Modules\Parties\Enums;

enum AddressType: string
{
    case Billing = 'billing';
    case Shipping = 'shipping';
    case Other = 'other';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $case): string => $case->value, self::cases());
    }
}
