<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Events;

use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;

/**
 * Hook for e-documents (Phase 9): fired after commit for supplier invoices and debit notes.
 */
final readonly class PurchaseInvoiceBooked implements ShouldDispatchAfterCommit
{
    public function __construct(
        public string $companyId,
        public string $invoiceId,
        public string $number,
        public string $invoiceType,
        public string $partyId,
        public string $journalEntryId,
        public string $totalLocal,
    ) {}
}
