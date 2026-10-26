<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Events;

use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * A journal entry was booked (also reversals and generated entries); dispatched after commit.
 */
final class EntryPosted implements ShouldDispatchAfterCommit
{
    use Dispatchable;

    public function __construct(
        public readonly string $companyId,
        public readonly string $entryId,
        public readonly string $number,
        public readonly string $entryType,
        public readonly ?string $sourceType,
        public readonly ?string $sourceId,
    ) {}
}
