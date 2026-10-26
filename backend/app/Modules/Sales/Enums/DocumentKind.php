<?php

declare(strict_types=1);

namespace App\Modules\Sales\Enums;

/**
 * Sales document types: number sequence key (the value) and series of each.
 * Numbers look like INV2027000000001 (series, fiscal year, nine digits).
 */
enum DocumentKind: string
{
    case Quote = 'sales_quote';
    case Order = 'sales_order';
    case Delivery = 'sales_delivery';
    case Invoice = 'sales_invoice';
    case CreditNote = 'sales_credit_note';
    case SalesReturn = 'sales_return';

    public function series(): string
    {
        return match ($this) {
            self::Quote => 'QUO',
            self::Order => 'ORD',
            self::Delivery => 'DLV',
            self::Invoice => 'INV',
            self::CreditNote => 'CRN',
            self::SalesReturn => 'RET',
        };
    }
}
