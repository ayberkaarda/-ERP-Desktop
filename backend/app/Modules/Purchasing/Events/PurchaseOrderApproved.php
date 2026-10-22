<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Events;

use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;

/** An order became approved (directly or through the approval workflow). */
final readonly class PurchaseOrderApproved implements ShouldDispatchAfterCommit
{
    public function __construct(
        public string $companyId,
        public string $orderId,
        public string $number,
        public string $partyId,
        public string $totalLocal,
    ) {}
}
