<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Http\Resources;

use App\Modules\Accounting\Models\AccountDeterminationRule;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin AccountDeterminationRule
 */
final class DeterminationRuleResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'event_key' => $this->event_key,
            'priority' => $this->priority,
            'conditions' => (object) $this->conditions,
            'account_id' => $this->account_id,
            'account_code' => $this->whenLoaded('account', fn (): string => $this->account->code),
            'account_name' => $this->whenLoaded('account', fn (): string => $this->account->name),
            'side' => $this->side?->value,
            'description' => $this->description,
            'is_system' => $this->is_system,
            'is_active' => $this->is_active,
            'version' => $this->version,
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
