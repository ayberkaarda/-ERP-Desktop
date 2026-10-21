<?php

declare(strict_types=1);

namespace App\Modules\Sales\Reports\Data;

use Brick\Math\BigDecimal;

/**
 * One invoice line as it moves revenue on one date: +1 on the document date of an issued invoice or
 * credit note, -1 on the reversal date of a reversed one. Amounts are unsigned line amounts; the
 * local ones are the line's share of the header's local net and VAT (largest remainder), so they
 * add up to the booked journal exactly.
 */
final readonly class RevenueFact
{
    public function __construct(
        public string $date,
        public int $sign,
        public bool $creditNote,
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
    ) {}

    /** Effect on net sales in company currency: sales add, credit notes subtract, reversals undo. */
    public function signedNetLocal(): BigDecimal
    {
        return $this->creditNote ? $this->netLocal->multipliedBy(-$this->sign) : $this->netLocal->multipliedBy($this->sign);
    }
}
