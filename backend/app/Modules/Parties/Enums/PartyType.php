<?php

declare(strict_types=1);

namespace App\Modules\Parties\Enums;

enum PartyType: string
{
    case Company = 'company';
    case Person = 'person';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $case): string => $case->value, self::cases());
    }
}
