<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Data;

/** A booked entry of the journal book with its lines; amounts are decimal strings. */
final readonly class JournalBookEntry
{
    /**
     * @param  list<JournalBookLine>  $lines
     */
    public function __construct(
        public string $id,
        public string $number,
        public string $entryDate,
        public string $entryType,
        public string $status,
        public ?string $description,
        public string $totalDebit,
        public string $totalCredit,
        public array $lines,
    ) {}
}
