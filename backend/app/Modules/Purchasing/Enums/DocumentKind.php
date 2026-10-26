<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Enums;

/**
 * Purchasing document types: number sequence key (the value) and series of each.
 * Numbers look like POR2027000000001 (series, fiscal year, nine digits).
 */
enum DocumentKind: string
{
    case Request = 'purchase_request';
    case Rfq = 'purchase_rfq';
    case Order = 'purchase_order';
    case Receipt = 'purchase_receipt';
    case Invoice = 'purchase_invoice';
    case DebitNote = 'purchase_debit_note';
    case PurchaseReturn = 'purchase_return';

    public function series(): string
    {
        return match ($this) {
            self::Request => 'PRQ',
            self::Rfq => 'RFQ',
            self::Order => 'POR',
            self::Receipt => 'GRN',
            self::Invoice => 'PIN',
            self::DebitNote => 'PDN',
            self::PurchaseReturn => 'PRT',
        };
    }
}
