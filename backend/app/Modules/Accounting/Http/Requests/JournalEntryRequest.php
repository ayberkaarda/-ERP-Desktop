<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Http\Requests;

use App\Modules\Accounting\Enums\EntryType;
use App\Modules\Accounting\Models\JournalEntry;
use Illuminate\Validation\Rule;

/**
 * Draft create/update. Amounts are decimal strings; balance and dimension requirements are checked
 * when the draft is posted.
 */
final class JournalEntryRequest extends AccountingRequest
{
    protected function gate(): array
    {
        return [$this->creating() ? 'create' : 'update', JournalEntry::class];
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $money = ['sometimes', 'string', 'regex:'.self::MONEY];

        return [
            'entry_type' => [$this->required(), Rule::in(array_map(static fn (EntryType $t): string => $t->value, EntryType::manual()))],
            'entry_date' => [$this->required(), 'date_format:Y-m-d'],
            'period_id' => ['sometimes', 'nullable', 'uuid'],
            'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'lines' => [$this->required(), 'array', 'min:1', 'max:'.JournalEntry::MAX_LINES],
            'lines.*' => ['array'],
            'lines.*.account_id' => ['required_without:lines.*.account_code', 'nullable', 'uuid'],
            'lines.*.account_code' => ['required_without:lines.*.account_id', 'nullable', 'string', 'max:32'],
            'lines.*.debit' => $money,
            'lines.*.credit' => $money,
            'lines.*.currency_code' => ['sometimes', 'nullable', 'string', 'size:3'],
            'lines.*.fx_amount' => ['sometimes', 'nullable', 'string', 'regex:'.self::MONEY],
            'lines.*.fx_rate' => ['sometimes', 'nullable', 'string', 'regex:/^\d{1,14}(\.\d{1,6})?$/'],
            'lines.*.party_id' => ['sometimes', 'nullable', 'uuid'],
            'lines.*.cost_center_id' => ['sometimes', 'nullable', 'uuid'],
            'lines.*.project_id' => ['sometimes', 'nullable', 'uuid'],
            'lines.*.description' => ['sometimes', 'nullable', 'string', 'max:500'],
            'lines.*.due_date' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'lines.*.document_ref' => ['sometimes', 'nullable', 'string', 'max:100'],
            'version' => $this->versionRule(),
        ];
    }
}
