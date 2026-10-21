<?php

declare(strict_types=1);

namespace App\Modules\Sales\Events;

use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;

final readonly class SalesDeliveryPosted implements ShouldDispatchAfterCommit
{
    public function __construct(
        public string $companyId,
        public string $deliveryId,
        public string $number,
        public ?string $orderId,
        public string $stockDocumentId,
        public ?string $journalEntryId,
        public string $costTotal,
    ) {}
}
