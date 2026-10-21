<?php

declare(strict_types=1);

namespace App\Modules\Sales\Enums;

enum InvoiceType: string
{
    case Sale = 'sale';
    case Return = 'return';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $c): string => $c->value, self::cases());
    }
}
