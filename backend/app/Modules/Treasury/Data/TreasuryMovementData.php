<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Data;

final readonly class TreasuryMovementData
{
    public function __construct(public string $id, public string $companyId, public string $accountId, public string $documentDate, public string $amount, public string $localAmount, public string $currencyCode, public string $sourceType, public string $sourceId, public string $journalEntryId, public ?string $reversesId) {}
}
