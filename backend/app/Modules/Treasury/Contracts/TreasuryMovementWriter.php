<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Contracts;

use App\Modules\Treasury\Data\TreasuryMovementData;

interface TreasuryMovementWriter
{
    /** Caller posts a balanced journal in the same transaction. Signed amounts are in account and company currency. */
    public function record(string $accountId, string $sourceType, string $sourceId, string $date, string $amount, string $localAmount, string $journalEntryId, ?string $reversesId = null): TreasuryMovementData;
}
