<?php

declare(strict_types=1);

namespace App\Modules\Sales\Events;

use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;

final readonly class SalesInvoiceReversed implements ShouldDispatchAfterCommit
{
    public function __construct(
        public string $companyId,
        public string $invoiceId,
        public string $number,
        public string $reversalJournalEntryId,
        public bool $stockReversed,
    ) {}
}
