<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Http\Resources;

use App\Modules\Accounting\Models\AccountingPeriod;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin AccountingPeriod
 */
final class AccountingPeriodResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'fiscal_year_id' => $this->fiscal_year_id,
            'number' => $this->number,
            'is_adjustment' => $this->number === AccountingPeriod::ADJUSTMENT,
            'start_date' => $this->start_date->format('Y-m-d'),
            'end_date' => $this->end_date->format('Y-m-d'),
            'status' => $this->status->value,
            'closed_at' => $this->closed_at?->toIso8601String(),
            'closed_by' => $this->closed_by,
            // Filled by the list endpoint so the board can show why a close is blocked.
            'draft_count' => $this->when(isset($this->draft_count), fn (): int => (int) $this->getAttribute('draft_count')),
            'version' => $this->version,
        ];
    }
}
