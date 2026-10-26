<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Events;

use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * A posted entry was reversed by $reversalId; dispatched after commit.
 */
final class EntryReversed implements ShouldDispatchAfterCommit
{
    use Dispatchable;

    public function __construct(
        public readonly string $companyId,
        public readonly string $entryId,
        public readonly string $reversalId,
        public readonly ?string $sourceType,
        public readonly ?string $sourceId,
    ) {}
}
