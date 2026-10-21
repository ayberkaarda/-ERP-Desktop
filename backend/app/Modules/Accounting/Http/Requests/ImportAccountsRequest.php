<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Http\Requests;

use App\Modules\Accounting\Models\Account;

final class ImportAccountsRequest extends AccountingRequest
{
    protected function gate(): array
    {
        return ['import', Account::class];
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'file' => ['required', 'file', 'max:5120', 'extensions:csv,txt,xlsx'],
            'dry_run' => ['sometimes', 'boolean'],
        ];
    }
}
