<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Http\Resources;

use App\Modules\Accounting\Reports\Data\LedgerLine;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A general ledger / account statement line. running_balance is debit positive (negative = credit
 * balance) and continues across pages. `party` is filled when the party is known.
 *
 * @property LedgerLine $resource
 */
final class LedgerLineResource extends JsonResource
{
    /**
     * @return array{line_id: string, entry_id: string, entry_number: string|null, entry_date: string, entry_type: string, entry_status: string, line_no: int, account_id: string, account_code: string, account_name: string, description: string|null, debit: string, credit: string, running_balance: string, party_id: string|null, party: array{id: string, code: string, name: string}|null, document_ref: string|null, due_date: string|null, currency_code: string|null, fx_amount: string|null}
     */
    public function toArray(Request $request): array
    {
        $line = $this->resource;
        $party = $line->party;

        return [
            'line_id' => $line->lineId,
            'entry_id' => $line->entryId,
            'entry_number' => $line->entryNumber,
            'entry_date' => $line->entryDate,
            'entry_type' => $line->entryType,
            'entry_status' => $line->entryStatus,
            'line_no' => $line->lineNo,
            'account_id' => $line->accountId,
            'account_code' => $line->accountCode,
            'account_name' => $line->accountName,
            'description' => $line->description,
            'debit' => $line->debit,
            'credit' => $line->credit,
            'running_balance' => $line->runningBalance,
            'party_id' => $line->partyId,
            'party' => $party === null ? null : ['id' => $party->id, 'code' => $party->code, 'name' => $party->name],
            'document_ref' => $line->documentRef,
            'due_date' => $line->dueDate,
            'currency_code' => $line->currencyCode,
            'fx_amount' => $line->fxAmount,
        ];
    }
}
