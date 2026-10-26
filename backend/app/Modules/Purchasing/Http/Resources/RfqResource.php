<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Http\Resources;

use App\Modules\Purchasing\Models\PurchaseRfq;
use App\Modules\Purchasing\Models\PurchaseRfqLine;
use App\Modules\Purchasing\Models\RfqQuote;
use App\Modules\Purchasing\Models\RfqSupplier;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * RFQ with its lines, invited suppliers and quotes (when loaded).
 *
 * @mixin PurchaseRfq
 */
final class RfqResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        /** @var PurchaseRfq $doc */
        $doc = $this->resource;
        $data = [
            'id' => $doc->id, 'document_type' => $doc::kind()->value, 'number' => $doc->number, 'status' => $doc->status->value,
            'document_date' => $doc->document_date->format('Y-m-d'), 'response_due' => $doc->response_due?->format('Y-m-d'),
            'request_id' => $doc->request_id, 'currency_code' => $doc->currency_code, 'warehouse_id' => $doc->warehouse_id,
            'notes' => $doc->notes, 'internal_notes' => $doc->internal_notes, 'sent_at' => $doc->sent_at?->toIso8601String(),
            'awarded_at' => $doc->awarded_at?->toIso8601String(), 'awarded_by' => $doc->awarded_by,
            'cancelled_at' => $doc->cancelled_at?->toIso8601String(), 'version' => $doc->version, 'created_by' => $doc->created_by,
            'created_at' => $doc->created_at?->toIso8601String(), 'updated_at' => $doc->updated_at?->toIso8601String(),
        ];

        if ($doc->getAttribute('lines_count') !== null) {
            $data['line_count'] = (int) $doc->getAttribute('lines_count');
        }

        if ($doc->relationLoaded('lines')) {
            $data['lines'] = array_values($doc->lines->map(static fn (PurchaseRfqLine $l): array => [
                'id' => $l->id, 'line_no' => $l->line_no, 'item_id' => $l->item_id, 'variant_id' => $l->variant_id, 'item_type' => $l->item_type,
                'description' => $l->description, 'quantity' => (string) $l->quantity, 'unit_id' => $l->unit_id, 'base_quantity' => (string) $l->base_quantity,
                'request_line_id' => $l->request_line_id, 'needed_by' => $l->needed_by?->format('Y-m-d'),
                'awarded_party_id' => $l->awarded_party_id, 'awarded_quote_id' => $l->awarded_quote_id,
            ])->all());
        }

        if ($doc->relationLoaded('suppliers')) {
            $data['suppliers'] = array_values($doc->suppliers->map(static fn (RfqSupplier $s): array => [
                'party_id' => $s->party_id, 'party_name' => $s->party_name, 'status' => $s->status, 'responded_at' => $s->responded_at?->toIso8601String(),
            ])->all());
        }

        if ($doc->relationLoaded('quotes')) {
            $data['quotes'] = array_values($doc->quotes->map(static fn (RfqQuote $q): array => [
                'id' => $q->id, 'rfq_line_id' => $q->rfq_line_id, 'party_id' => $q->party_id, 'unit_price' => (string) $q->unit_price,
                'discount_percent' => (string) $q->discount_percent, 'net_unit_price' => (string) $q->netPrice(), 'lead_time_days' => $q->lead_time_days,
                'valid_until' => $q->valid_until?->format('Y-m-d'), 'notes' => $q->notes,
            ])->all());
        }

        return $data;
    }
}
