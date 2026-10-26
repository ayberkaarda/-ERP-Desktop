<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Data;

final readonly class JournalBookLine
{
    public function __construct(
        public int $lineNo,
        public string $accountId,
        public string $accountCode,
        public string $accountName,
        public ?string $description,
        public string $debit,
        public string $credit,
        public ?string $partyId,
    ) {}
}
