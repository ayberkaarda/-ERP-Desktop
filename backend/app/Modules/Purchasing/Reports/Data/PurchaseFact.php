<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Reports\Data;

use Brick\Math\BigDecimal;

/**
 * One supplier invoice line as it moves purchases on one date: +1 on the document date of a booked
 * invoice or debit note, -1 on the reversal date of a reversed one. Amounts are unsigned line
 * amounts; the local ones are what the booking journal carries for the line: net_local as stored
 * at booking, and the line's share of the header's local VAT (total_local - net) and withheld VAT
 * (largest remainder), so they add up to the journal exactly.
 */
final readonly class PurchaseFact
{
    public function __construct(
        public string $date,
        public int $sign,
        public bool $debitNote,
        public string $invoiceId,
        public string $partyId,
        public string $partyName,
        public string $currencyCode,
        public string $itemId,
        public string $itemType,
        public ?string $warehouseId,
        public BigDecimal $baseQuantity,
        public BigDecimal $net,
        public BigDecimal $netLocal,
        public BigDecimal $taxLocal,
        public BigDecimal $withholdingLocal,
    ) {}

    /** Effect on net purchases in company currency: invoices add, debit notes subtract, reversals undo. */
    public function signedNetLocal(): BigDecimal
    {
        return $this->debitNote ? $this->netLocal->multipliedBy(-$this->sign) : $this->netLocal->multipliedBy($this->sign);
    }
}
