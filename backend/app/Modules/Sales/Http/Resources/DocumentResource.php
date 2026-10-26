<?php

declare(strict_types=1);

namespace App\Modules\Sales\Http\Resources;

use App\Modules\Sales\Models\SalesDelivery;
use App\Modules\Sales\Models\SalesDocument;
use App\Modules\Sales\Models\SalesInvoice;
use App\Modules\Sales\Models\SalesOrder;
use App\Modules\Sales\Models\SalesQuote;
use App\Modules\Sales\Models\SalesReturn;
use App\Modules\Sales\Services\ReturnableSerials;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Carbon;

/**
 * One shape for all sales documents (common header, totals in document and company currency,
 * type-specific fields, lines when loaded). Money, quantities and rates are decimal strings.
 *
 * @mixin SalesDocument
 */
final class DocumentResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        /** @var SalesDocument $doc */
        $doc = $this->resource;
        $data = [
            'id' => $doc->id,
            'document_type' => $doc::kind()->value,
            'number' => $doc->number,
            'status' => $doc->currentStatus(),
            'document_date' => $doc->document_date->format('Y-m-d'),
            'party_id' => $doc->party_id,
            'party_name' => $doc->party_name,
            'party_tax_office' => $doc->party_tax_office,
            'party_tax_number' => $doc->party_tax_number,
            'billing_address' => $doc->billing_address,
            'currency_code' => $doc->currency_code,
            'fx_rate' => (string) $doc->fx_rate,
            'payment_term_id' => $doc->payment_term_id,
            'due_date' => $doc->due_date?->format('Y-m-d'),
            'price_list_id' => $doc->price_list_id,
            'warehouse_id' => $doc->warehouse_id,
            'cost_center_id' => $doc->cost_center_id,
            'project_id' => $doc->project_id,
            'notes' => $doc->notes,
            'internal_notes' => $doc->internal_notes,
            'source_type' => $doc->source_type,
            'source_id' => $doc->source_id,
        ];

        foreach (SalesDocument::TOTALS as $column) {
            $data[$column] = (string) $doc->getAttribute($column);
        }

        $data += $this->specific($doc);
        $data['version'] = $doc->version;
        $data['created_by'] = $doc->created_by;
        $data['created_at'] = $doc->created_at?->toIso8601String();
        $data['updated_at'] = $doc->updated_at?->toIso8601String();

        if ($doc->getAttribute('lines_count') !== null) {
            $data['line_count'] = (int) $doc->getAttribute('lines_count');
        }

        if ($doc->relationLoaded('lines')) {
            $data['lines'] = LineResource::collection($doc->lines)->resolve($request);

            if ($doc instanceof SalesInvoice && ! $doc->isCreditNote()) {
                // Serials a new return may pick per line (serial-tracked goods are returned by serial).
                $serials = ReturnableSerials::forLines($doc->lines);
                $data['lines'] = array_map(static fn (array $l): array => [...$l, 'returnable_serials' => $serials[$l['id']] ?? []], $data['lines']);
            }
        }

        return $data;
    }

    /** @return array<string, mixed> */
    private function specific(SalesDocument $doc): array
    {
        return match (true) {
            $doc instanceof SalesQuote => [
                'valid_until' => $doc->valid_until?->format('Y-m-d'), 'revision' => $doc->revision, 'previous_revision_id' => $doc->previous_revision_id,
                'converted_order_id' => $doc->converted_order_id, 'sent_at' => self::time($doc->sent_at), 'accepted_at' => self::time($doc->accepted_at),
                'rejected_at' => self::time($doc->rejected_at), 'rejection_reason' => $doc->rejection_reason,
            ],
            $doc instanceof SalesOrder => [
                'requested_delivery_date' => $doc->requested_delivery_date?->format('Y-m-d'), 'quote_id' => $doc->quote_id, 'revision' => $doc->revision,
                'credit_override_reason' => $doc->credit_override_reason, 'credit_override_by' => $doc->credit_override_by,
                'approval_request_id' => $doc->approval_request_id, 'approval_comment' => $doc->approval_comment,
                'confirmed_at' => self::time($doc->confirmed_at), 'confirmed_by' => $doc->confirmed_by,
                'cancelled_at' => self::time($doc->cancelled_at), 'closed_at' => self::time($doc->closed_at),
            ],
            $doc instanceof SalesDelivery => [
                'order_id' => $doc->order_id, 'invoice_id' => $doc->invoice_id, 'stock_document_id' => $doc->stock_document_id,
                'journal_entry_id' => $doc->journal_entry_id, 'cost_total' => (string) $doc->cost_total,
                'posted_at' => self::time($doc->posted_at), 'posted_by' => $doc->posted_by, 'cancelled_at' => self::time($doc->cancelled_at),
                'cancel_reason' => $doc->cancel_reason, 'reversal_stock_document_id' => $doc->reversal_stock_document_id,
                'reversal_date' => $doc->reversal_date?->format('Y-m-d'),
            ],
            $doc instanceof SalesInvoice => [
                'invoice_type' => $doc->invoice_type->value, 'order_id' => $doc->order_id, 'delivery_id' => $doc->delivery_id,
                'return_id' => $doc->return_id, 'original_invoice_id' => $doc->original_invoice_id, 'deliver_on_invoice' => $doc->deliver_on_invoice,
                'journal_entry_id' => $doc->journal_entry_id, 'reversal_journal_entry_id' => $doc->reversal_journal_entry_id,
                'paid_amount' => (string) $doc->paid_amount, 'balance_due' => (string) $doc->balance_due,
                'issued_at' => self::time($doc->issued_at), 'issued_by' => $doc->issued_by, 'reversed_at' => self::time($doc->reversed_at),
                'reversal_date' => $doc->reversal_date?->format('Y-m-d'), 'reversal_reason' => $doc->reversal_reason,
                'credit_override_reason' => $doc->credit_override_reason, 'e_document_status' => $doc->e_document_status, 'e_document_uuid' => $doc->e_document_uuid,
            ],
            $doc instanceof SalesReturn => [
                'invoice_id' => $doc->invoice_id, 'reason' => $doc->reason, 'stock_document_id' => $doc->stock_document_id,
                'journal_entry_id' => $doc->journal_entry_id, 'credit_invoice_id' => $doc->credit_invoice_id,
                'approved_at' => self::time($doc->approved_at), 'received_at' => self::time($doc->received_at),
                'credited_at' => self::time($doc->credited_at), 'cancelled_at' => self::time($doc->cancelled_at),
            ],
            default => [],
        };
    }

    private static function time(?Carbon $value): ?string
    {
        return $value?->toIso8601String();
    }
}
