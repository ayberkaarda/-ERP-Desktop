<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Enums;

enum MovementType: string
{
    case Receipt = 'receipt';
    case Issue = 'issue';
    case TransferOut = 'transfer_out';
    case TransferIn = 'transfer_in';
    case CountAdjustment = 'count_adjustment';
    case Opening = 'opening';
    case ReturnIn = 'return_in';
    case ReturnOut = 'return_out';
    case ProductionIn = 'production_in';
    case ProductionOut = 'production_out';
    case Scrap = 'scrap';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $c): string => $c->value, self::cases());
    }
}
