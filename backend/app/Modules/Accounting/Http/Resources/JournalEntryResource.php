<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Http\Resources;

use App\Modules\Accounting\Models\JournalEntry;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin JournalEntry
 */
final class JournalEntryResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'number' => $this->number,
            'entry_type' => $this->entry_type->value,
            'entry_date' => $this->entry_date->format('Y-m-d'),
            'period_id' => $this->period_id,
            'fiscal_year_id' => $this->fiscal_year_id,
            'description' => $this->description,
            'status' => $this->status->value,
            'source_type' => $this->source_type,
            'source_id' => $this->source_id,
            'reverses_id' => $this->reverses_id,
            'reversed_by_id' => $this->reversed_by_id,
            'reversal_reason' => $this->reversal_reason,
            'total_debit' => (string) $this->total_debit,
            'total_credit' => (string) $this->total_credit,
            'difference' => (string) $this->total_debit->minus($this->total_credit),
            'created_by' => $this->created_by,
            'posted_by' => $this->posted_by,
            'posted_at' => $this->posted_at?->toIso8601String(),
            'version' => $this->version,
            'lines' => $this->whenLoaded('lines', fn () => JournalLineResource::collection($this->lines)->resolve($request)),
            'line_count' => $this->when(isset($this->lines_count), fn (): int => (int) $this->getAttribute('lines_count')),
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
