<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Http\Resources;

use App\Modules\Purchasing\Models\PurchaseRequest;
use App\Modules\Purchasing\Models\PurchaseRequestLine;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Purchase request with its lines (when loaded); estimated amounts in company currency.
 *
 * @mixin PurchaseRequest
 */
final class RequestResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        /** @var PurchaseRequest $doc */
        $doc = $this->resource;
        $data = [
            'id' => $doc->id, 'document_type' => $doc::kind()->value, 'number' => $doc->number, 'status' => $doc->status->value,
            'document_date' => $doc->document_date->format('Y-m-d'), 'needed_by' => $doc->needed_by?->format('Y-m-d'),
            'requested_by' => $doc->requested_by, 'warehouse_id' => $doc->warehouse_id, 'cost_center_id' => $doc->cost_center_id,
            'project_id' => $doc->project_id, 'currency_code' => $doc->currency_code, 'notes' => $doc->notes, 'internal_notes' => $doc->internal_notes,
            'estimated_total' => (string) $doc->estimated_total, 'approval_request_id' => $doc->approval_request_id,
            'approval_comment' => $doc->approval_comment, 'submitted_at' => $doc->submitted_at?->toIso8601String(),
            'approved_at' => $doc->approved_at?->toIso8601String(), 'rejected_at' => $doc->rejected_at?->toIso8601String(),
            'cancelled_at' => $doc->cancelled_at?->toIso8601String(), 'version' => $doc->version, 'created_by' => $doc->created_by,
            'created_at' => $doc->created_at?->toIso8601String(), 'updated_at' => $doc->updated_at?->toIso8601String(),
        ];

        if ($doc->getAttribute('lines_count') !== null) {
            $data['line_count'] = (int) $doc->getAttribute('lines_count');
        }

        if ($doc->relationLoaded('lines')) {
            $data['lines'] = array_values($doc->lines->map(static fn (PurchaseRequestLine $l): array => [
                'id' => $l->id, 'line_no' => $l->line_no, 'item_id' => $l->item_id, 'variant_id' => $l->variant_id, 'item_type' => $l->item_type,
                'description' => $l->description, 'quantity' => (string) $l->quantity, 'unit_id' => $l->unit_id, 'base_quantity' => (string) $l->base_quantity,
                'estimated_price' => (string) $l->estimated_price, 'estimated_total' => (string) $l->estimated_total,
                'suggested_supplier_id' => $l->suggested_supplier_id, 'needed_by' => $l->needed_by?->format('Y-m-d'), 'warehouse_id' => $l->warehouse_id,
                'ordered_quantity' => $l->getAttribute('ordered_quantity'),
            ])->all());
        }

        return $data;
    }
}
