<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Data;

use App\Modules\Accounting\Models\Account;

final readonly class AccountData
{
    public function __construct(
        public string $id,
        public string $code,
        public string $name,
        public string $type,
        public string $normalBalance,
        public bool $isPostable,
        public bool $isActive,
        public ?string $parentId,
        public int $level,
        public ?int $tdhpGroup,
        public ?string $currencyCode,
        public bool $requiresParty,
        public bool $requiresCostCenter,
        public bool $requiresProject,
        public bool $isRevaluable,
    ) {}

    public static function of(Account $account): self
    {
        return new self(
            $account->id,
            $account->code,
            $account->name,
            $account->type->value,
            $account->normal_balance->value,
            $account->is_postable,
            $account->is_active,
            $account->parent_id,
            $account->level,
            $account->tdhp_group,
            $account->currency_code,
            $account->requires_party,
            $account->requires_cost_center,
            $account->requires_project,
            $account->is_revaluable,
        );
    }
}
