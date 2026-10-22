<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Events;

use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;

final readonly class PurchaseReturnDebited implements ShouldDispatchAfterCommit
{
    public function __construct(
        public string $companyId,
        public string $returnId,
        public string $number,
        public string $debitNoteId,
        public string $totalLocal,
    ) {}
}
