<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Contracts;

use App\Modules\Purchasing\Data\SettlementData;

/**
 * Maintains paid_amount and balance_due of booked supplier invoices for treasury (Phase 7). Amounts
 * are in the invoice currency. Both calls are idempotent by (invoice, reference).
 */
interface PayableSettlement
{
    /** Applies $amount (> 0, at most the balance) under $reference; a repeated reference returns the first result. */
    public function apply(string $companyId, string $invoiceId, string $amount, string $reference, ?string $effectiveDate = null, ?string $localAmount = null): SettlementData;

    /** Takes the application of $reference back; unapplying twice returns the first result. */
    public function unapply(string $companyId, string $invoiceId, string $reference, ?string $effectiveDate = null): SettlementData;
}
