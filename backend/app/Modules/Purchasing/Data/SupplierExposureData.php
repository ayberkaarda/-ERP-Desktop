<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Data;

/**
 * Informational supplier exposure in company currency (scale 2): open payables (booked invoices
 * less open debit notes), approved orders not yet invoiced, their total, and overdue payables.
 */
final readonly class SupplierExposureData
{
    public function __construct(
        public string $partyId,
        public string $currency,
        public string $openPayables,
        public string $openOrders,
        public string $total,
        public string $overduePayables,
    ) {}

    /** @return array<string, string> */
    public function toArray(): array
    {
        return [
            'party_id' => $this->partyId, 'currency' => $this->currency, 'open_payables' => $this->openPayables,
            'open_orders' => $this->openOrders, 'total' => $this->total, 'overdue_payables' => $this->overduePayables,
        ];
    }
}
