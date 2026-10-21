<?php

declare(strict_types=1);

namespace App\Modules\Sales\Events;

use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;

final readonly class SalesOrderConfirmed implements ShouldDispatchAfterCommit
{
    public function __construct(
        public string $companyId,
        public string $orderId,
        public string $number,
        public string $partyId,
        public string $totalLocal,
    ) {}
}
