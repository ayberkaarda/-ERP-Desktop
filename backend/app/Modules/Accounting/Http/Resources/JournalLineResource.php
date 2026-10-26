<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Http\Resources;

use App\Modules\Accounting\Models\JournalLine;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin JournalLine
 */
final class JournalLineResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'line_no' => $this->line_no,
            'account_id' => $this->account_id,
            'account_code' => $this->whenLoaded('account', fn (): string => $this->account->code),
            'account_name' => $this->whenLoaded('account', fn (): string => $this->account->name),
            'debit' => (string) $this->debit,
            'credit' => (string) $this->credit,
            'currency_code' => $this->currency_code,
            'fx_amount' => $this->fx_amount?->__toString(),
            'fx_rate' => $this->fx_rate?->__toString(),
            'party_id' => $this->party_id,
            'cost_center_id' => $this->cost_center_id,
            'project_id' => $this->project_id,
            'description' => $this->description,
            'due_date' => $this->due_date?->format('Y-m-d'),
            'document_ref' => $this->document_ref,
        ];
    }
}
