<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Http\Resources;

use App\Modules\Accounting\Models\Account;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Account
 */
final class AccountResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return self::fields($this->resource);
    }

    /**
     * @return array<string, mixed>
     */
    public static function fields(Account $account): array
    {
        return [
            'id' => $account->id,
            'code' => $account->code,
            'name' => $account->name,
            'parent_id' => $account->parent_id,
            'level' => $account->level,
            'type' => $account->type->value,
            'normal_balance' => $account->normal_balance->value,
            'is_postable' => $account->is_postable,
            'is_active' => $account->is_active,
            'is_system' => $account->is_system,
            'tdhp_group' => $account->tdhp_group,
            'currency_code' => $account->currency_code,
            'requires_party' => $account->requires_party,
            'requires_cost_center' => $account->requires_cost_center,
            'requires_project' => $account->requires_project,
            'is_revaluable' => $account->is_revaluable,
            'notes' => $account->notes,
            'version' => $account->version,
            'created_at' => $account->created_at?->toIso8601String(),
            'updated_at' => $account->updated_at?->toIso8601String(),
        ];
    }
}
