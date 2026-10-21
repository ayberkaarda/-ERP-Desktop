<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Events;

use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * A stock document was posted; dispatched after commit.
 */
final class StockPosted implements ShouldDispatchAfterCommit
{
    use Dispatchable;

    public function __construct(
        public readonly string $companyId,
        public readonly string $documentId,
        public readonly string $documentType,
        public readonly string $number,
        public readonly ?string $sourceType,
        public readonly ?string $sourceId,
        public readonly ?string $journalEntryId,
    ) {}
}
