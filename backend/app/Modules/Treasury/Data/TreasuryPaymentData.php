<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Data;

final readonly class TreasuryPaymentData
{
    public function __construct(public string $id, public string $companyId, public string $accountId, public string $partyId, public string $direction, public string $amount, public string $currencyCode, public string $documentDate, public string $status, public ?string $journalEntryId, public ?string $reference, public int $version) {}
}
