<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Events;

use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * A posted stock document was reversed (and is now cancelled); dispatched after commit.
 */
final class StockReversed implements ShouldDispatchAfterCommit
{
    use Dispatchable;

    public function __construct(
        public readonly string $companyId,
        public readonly string $documentId,
        public readonly string $documentType,
        public readonly ?string $sourceType,
        public readonly ?string $sourceId,
        public readonly ?string $reversalJournalEntryId,
    ) {}
}
