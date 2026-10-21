<?php

declare(strict_types=1);

namespace App\Modules\Sales\Enums;

enum ReturnStatus: string
{
    case Draft = 'draft';
    case Approved = 'approved';
    case Received = 'received';
    case Credited = 'credited';
    case Cancelled = 'cancelled';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $c): string => $c->value, self::cases());
    }
}
