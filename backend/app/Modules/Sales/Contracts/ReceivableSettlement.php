<?php

declare(strict_types=1);

namespace App\Modules\Sales\Contracts;

use App\Modules\Sales\Data\SettlementData;

/**
 * Maintains paid_amount and balance_due of issued invoices for treasury (Phase 7). Amounts are in
 * the invoice currency. Both calls are idempotent by (invoice, reference).
 */
interface ReceivableSettlement
{
    /** Applies $amount (> 0, at most the balance) under $reference; a repeated reference returns the first result. */
    public function apply(string $companyId, string $invoiceId, string $amount, string $reference, ?string $effectiveDate = null, ?string $localAmount = null): SettlementData;

    /** Takes the application of $reference back; unapplying twice returns the first result. */
    public function unapply(string $companyId, string $invoiceId, string $reference, ?string $effectiveDate = null): SettlementData;
}
