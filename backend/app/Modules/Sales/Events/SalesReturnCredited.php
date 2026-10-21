<?php

declare(strict_types=1);

namespace App\Modules\Sales\Events;

use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;

final readonly class SalesReturnCredited implements ShouldDispatchAfterCommit
{
    public function __construct(
        public string $companyId,
        public string $returnId,
        public string $number,
        public string $creditInvoiceId,
        public string $invoiceId,
    ) {}
}
