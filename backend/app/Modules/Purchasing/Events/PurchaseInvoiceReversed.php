<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Events;

use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;

final readonly class PurchaseInvoiceReversed implements ShouldDispatchAfterCommit
{
    public function __construct(
        public string $companyId,
        public string $invoiceId,
        public string $number,
        public string $reversalEntryId,
        public bool $stockReversed,
    ) {}
}
