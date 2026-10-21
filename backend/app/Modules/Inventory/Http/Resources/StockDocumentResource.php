<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Resources;

use App\Modules\Inventory\Enums\DocumentType;
use App\Modules\Inventory\Models\StockDocument;
use App\Modules\Inventory\Models\StockDocumentLine;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\DB;

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
            'lines' => $this->whenLoaded('lines', fn (): array => StockDocumentLineResource::collection($this->withCountCosts())->resolve($request)),
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }

    /**
     * Count lines carry the current moving average of their item in the warehouse as avg_cost, so
     * the variance can be valued before posting (one query; other document types are unchanged).
     *
     * @return iterable<StockDocumentLine>
     */
    private function withCountCosts(): iterable
    {
        $lines = $this->lines;

        if ($this->doc_type !== DocumentType::Count || $lines->isEmpty()) {
            return $lines;
        }

        $costs = DB::table('stock_valuations')->where('company_id', $this->company_id)->where('warehouse_id', $this->warehouse_id)
            ->whereIn('item_id', $lines->pluck('item_id')->unique()->values()->all())->pluck('avg_cost', 'item_id');

        foreach ($lines as $line) {
            $cost = $costs[$line->item_id] ?? null;
            $line->setAttribute('avg_cost', is_numeric($cost) ? (string) $cost : '0');
        }

        return $lines;
    }
}
