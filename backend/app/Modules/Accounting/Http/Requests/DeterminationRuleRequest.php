<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Http\Requests;

use App\Modules\Accounting\Enums\Side;
use App\Modules\Accounting\Models\AccountDeterminationRule;
use Illuminate\Validation\Rule;

final class DeterminationRuleRequest extends AccountingRequest
{
    public const string EVENT_KEY = '/^[a-z0-9_]+(\.[a-z0-9_]+)*(\.\*)?$/';

    protected function gate(): array
    {
        return [$this->creating() ? 'create' : 'update', AccountDeterminationRule::class];
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'event_key' => [$this->required(), 'string', 'max:100', 'regex:'.self::EVENT_KEY],
            'priority' => ['sometimes', 'integer', 'between:-100000,100000'],
            'conditions' => ['sometimes', 'array'],
            'conditions.*' => ['required'],
            'account_id' => [$this->required(), 'uuid'],
            'side' => ['sometimes', 'nullable', Rule::enum(Side::class)],
            'description' => ['sometimes', 'nullable', 'string', 'max:500'],
            'is_active' => ['sometimes', 'boolean'],
            'version' => $this->versionRule(),
        ];
    }
}
