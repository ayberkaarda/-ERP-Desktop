<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Enums;

enum RfqStatus: string
{
    case Draft = 'draft';
    case Sent = 'sent';
    case Collecting = 'collecting';
    case Awarded = 'awarded';
    case Cancelled = 'cancelled';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $c): string => $c->value, self::cases());
    }
}
