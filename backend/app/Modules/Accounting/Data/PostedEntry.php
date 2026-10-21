<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Data;

use App\Modules\Accounting\Models\JournalEntry;

final readonly class PostedEntry
{
    public function __construct(
        public string $id,
        public string $number,
        public string $entryDate,
        public string $entryType,
        public string $status,
        public string $periodId,
        public string $fiscalYearId,
        public string $totalDebit,
        public string $totalCredit,
        public ?string $reversesId = null,
        /** True when an earlier booking with the same posting key was returned. */
        public bool $replayed = false,
    ) {}

    public static function of(JournalEntry $entry, bool $replayed = false): self
    {
        return new self(
            $entry->id,
            (string) $entry->number,
            $entry->entry_date->format('Y-m-d'),
            $entry->entry_type->value,
            $entry->status->value,
            $entry->period_id,
            $entry->fiscal_year_id,
            (string) $entry->total_debit,
            (string) $entry->total_credit,
            $entry->reverses_id,
            $replayed,
        );
    }
}
