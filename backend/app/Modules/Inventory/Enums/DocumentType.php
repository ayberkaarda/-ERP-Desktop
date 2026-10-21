<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Enums;

enum DocumentType: string
{
    case Receipt = 'receipt';
    case Issue = 'issue';
    case Transfer = 'transfer';
    case Count = 'count';
    case Adjustment = 'adjustment';
    case Opening = 'opening';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $c): string => $c->value, self::cases());
    }

    /** Number sequence document type (gapless per company, type and year). */
    public function sequence(): string
    {
        return 'stock_'.$this->value;
    }

    /** Number prefix, e.g. REC2027000000001. */
    public function series(): string
    {
        return match ($this) {
            self::Receipt => 'REC',
            self::Issue => 'ISS',
            self::Transfer => 'TRF',
            self::Count => 'CNT',
            self::Adjustment => 'ADJ',
            self::Opening => 'OPN',
        };
    }
}
