<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Http\Requests;

/**
 * party_id: the party of the lines; account_from/account_to: optional account code range
 * (account_to includes its sub-accounts); page/per_page (max 500).
 */
final class AccountStatementRequest extends ReportRequest
{
    /** @return array<string, mixed> */
    protected function reportRules(): array
    {
        return [
            'party_id' => ['required', 'uuid'],
            'account_from' => ['sometimes', 'nullable', 'string', 'max:32'],
            'account_to' => ['sometimes', 'nullable', 'string', 'max:32'],
            ...$this->paginationRules(),
        ];
    }

    public function partyId(): string
    {
        return (string) $this->text('party_id');
    }

    public function accountFrom(): ?string
    {
        return $this->text('account_from');
    }

    public function accountTo(): ?string
    {
        return $this->text('account_to');
    }
}
