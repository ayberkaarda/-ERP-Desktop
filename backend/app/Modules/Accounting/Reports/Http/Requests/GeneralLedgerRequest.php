<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Http\Requests;

/** account_id: the account (a parent account covers its sub-accounts); page/per_page (max 500). */
final class GeneralLedgerRequest extends ReportRequest
{
    /** @return array<string, mixed> */
    protected function reportRules(): array
    {
        return [
            'account_id' => ['required', 'uuid'],
            ...$this->paginationRules(),
        ];
    }

    public function accountId(): string
    {
        return (string) $this->text('account_id');
    }
}
