<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Data;

use App\Modules\Parties\Data\PartyData;

/**
 * One booked journal line with the debit-positive running balance after it (general ledger and
 * account statement). Amounts are decimal strings.
 */
final readonly class LedgerLine
{
    public function __construct(
        public string $lineId,
        public string $entryId,
        public ?string $entryNumber,
        public string $entryDate,
        public string $entryType,
        public string $entryStatus,
        public int $lineNo,
        public string $accountId,
        public string $accountCode,
        public string $accountName,
        public ?string $description,
        public string $debit,
        public string $credit,
        public string $runningBalance,
        public ?string $partyId,
        public ?string $documentRef,
        public ?string $dueDate,
        public ?string $currencyCode,
        public ?string $fxAmount,
        public ?PartyData $party = null,
    ) {}

    public function withParty(?PartyData $party): self
    {
        return new self(...[...get_object_vars($this), 'party' => $party]);
    }
}
