<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Http\Requests;

use App\Modules\Accounting\Enums\AccountType;
use App\Modules\Accounting\Enums\NormalBalance;
use App\Modules\Accounting\Models\Account;
use Illuminate\Validation\Rule;

final class AccountRequest extends AccountingRequest
{
    protected function gate(): array
    {
        return [$this->creating() ? 'create' : 'update', Account::class];
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'code' => [$this->required(), 'string', 'max:32', 'regex:/^\S+$/'],
            'name' => [$this->required(), 'string', 'max:200'],
            'parent_id' => ['sometimes', 'nullable', 'uuid'],
            'parent_code' => $this->creating() ? ['sometimes', 'nullable', 'string', 'max:32'] : ['prohibited'],
            'type' => ['sometimes', Rule::enum(AccountType::class)],
            'normal_balance' => ['sometimes', Rule::enum(NormalBalance::class)],
            'is_postable' => ['sometimes', 'boolean'],
            'is_active' => ['sometimes', 'boolean'],
            'tdhp_group' => ['sometimes', 'nullable', 'integer', 'between:1,9'],
            'currency_code' => ['sometimes', 'nullable', 'string', 'size:3', 'regex:/^[A-Z]{3}$/'],
            'requires_party' => ['sometimes', 'boolean'],
            'requires_cost_center' => ['sometimes', 'boolean'],
            'requires_project' => ['sometimes', 'boolean'],
            'is_revaluable' => ['sometimes', 'boolean'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'version' => $this->versionRule(),
        ];
    }
}
