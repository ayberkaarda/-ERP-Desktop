<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Http\Resources;

use App\Modules\Accounting\Reports\Data\JournalBookEntry;
use App\Modules\Accounting\Reports\Data\JournalBookLine;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A booked entry of the journal book with its lines (decimal strings).
 *
 * @property JournalBookEntry $resource
 */
final class JournalBookEntryResource extends JsonResource
{
    /**
     * @return array{id: string, number: string, entry_date: string, entry_type: string, status: string, description: string|null, total_debit: string, total_credit: string, lines: list<array{line_no: int, account_id: string, account_code: string, account_name: string, description: string|null, debit: string, credit: string, party_id: string|null}>}
     */
    public function toArray(Request $request): array
    {
        $entry = $this->resource;

        return [
            'id' => $entry->id,
            'number' => $entry->number,
            'entry_date' => $entry->entryDate,
            'entry_type' => $entry->entryType,
            'status' => $entry->status,
            'description' => $entry->description,
            'total_debit' => $entry->totalDebit,
            'total_credit' => $entry->totalCredit,
            'lines' => array_map(static fn (JournalBookLine $line): array => [
                'line_no' => $line->lineNo,
                'account_id' => $line->accountId,
                'account_code' => $line->accountCode,
                'account_name' => $line->accountName,
                'description' => $line->description,
                'debit' => $line->debit,
                'credit' => $line->credit,
                'party_id' => $line->partyId,
            ], $entry->lines),
        ];
    }
}
