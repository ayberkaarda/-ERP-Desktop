<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Events;

use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;

final readonly class PurchaseReceiptPosted implements ShouldDispatchAfterCommit
{
    public function __construct(
        public string $companyId,
        public string $receiptId,
        public string $number,
        public ?string $orderId,
        public string $stockDocumentId,
        public ?string $journalEntryId,
        public string $costTotal,
    ) {}
}
