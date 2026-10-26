<?php

declare(strict_types=1);

namespace App\Modules\Sales\Data;

/**
 * Customer exposure in the party's risk currency (company currency when the party has none),
 * decimal strings at scale 2. limit and available are null for parties without a risk limit.
 */
final readonly class ExposureData
{
    public function __construct(
        public string $partyId,
        public ?string $limit,
        public string $currency,
        /** Open (issued, partially paid) invoice balances minus open credit note balances. */
        public string $openInvoices,
        /** Confirmed, not yet invoiced order value. */
        public string $openOrders,
        public string $total,
        public ?string $available,
    ) {}

    /** @return array<string, string|null> */
    public function toArray(): array
    {
        return [
            'party_id' => $this->partyId, 'limit' => $this->limit, 'currency' => $this->currency, 'open_invoices' => $this->openInvoices,
            'open_orders' => $this->openOrders, 'total' => $this->total, 'available' => $this->available,
        ];
    }
}
