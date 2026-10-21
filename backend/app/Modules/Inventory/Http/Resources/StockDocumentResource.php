<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Resources;

use App\Modules\Inventory\Models\StockDocument;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin StockDocument
 */
final class StockDocumentResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'doc_type' => $this->doc_type->value,
            'number' => $this->number,
            'status' => $this->status->value,
            'document_date' => $this->document_date->format('Y-m-d'),
            'warehouse_id' => $this->warehouse_id,
            'target_warehouse_id' => $this->target_warehouse_id,
            'reason' => $this->reason,
            'notes' => $this->notes,
            'offset_event' => $this->offset_event,
            'allow_expired' => $this->allow_expired,
            'source_type' => $this->source_type,
            'source_id' => $this->source_id,
            'journal_entry_id' => $this->journal_entry_id,
            'frozen_at' => $this->frozen_at?->toIso8601String(),
            'posted_at' => $this->posted_at?->toIso8601String(),
            'posted_by' => $this->posted_by,
            'reversal_date' => $this->reversal_date?->format('Y-m-d'),
            'reversal_reason' => $this->reversal_reason,
            'reversal_journal_entry_id' => $this->reversal_journal_entry_id,
            'reversed_at' => $this->reversed_at?->toIso8601String(),
            'reversed_by' => $this->reversed_by,
            'created_by' => $this->created_by,
            'version' => $this->version,
            'line_count' => $this->when(isset($this->lines_count), fn (): int => (int) $this->getAttribute('lines_count')),
            'lines' => $this->whenLoaded('lines', fn (): array => StockDocumentLineResource::collection($this->lines)->resolve($request)),
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
