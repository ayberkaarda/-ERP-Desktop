<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Contracts;

use App\Modules\Accounting\Data\PostedEntry;
use App\Modules\Accounting\Data\PostingRequest;
use DateTimeInterface;

/**
 * The only way documents of other modules book into the ledger.
 */
interface PostingService
{
    /**
     * Books a balanced entry in one transaction: number, lines and balances. Idempotent per
     * (company, source type, source id, purpose): a repeated request returns the booked entry.
     */
    public function post(PostingRequest $request): PostedEntry;

    /**
     * Books the mirrored entry of a posted entry of the active company on $date and links both.
     */
    public function reverse(string $entryId, DateTimeInterface $date, string $reason): PostedEntry;
}
