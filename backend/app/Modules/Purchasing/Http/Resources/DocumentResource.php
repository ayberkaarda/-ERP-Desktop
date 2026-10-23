<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Http\Resources;

use App\Modules\Purchasing\Models\PurchaseDocument;
use App\Modules\Purchasing\Models\PurchaseInvoice;
use App\Modules\Purchasing\Models\PurchaseOrder;
use App\Modules\Purchasing\Models\PurchaseReceipt;
use App\Modules\Purchasing\Models\PurchaseReturn;
use App\Modules\Purchasing\Services\Quantities;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Carbon;

/**
 * One shape for orders, receipts, invoices and returns (common header, totals in document and
 * company currency incl. withholding, type-specific fields, lines when loaded). Money, quantities
 * and rates are decimal strings.
 *
 * @mixin PurchaseDocument
 */
final class DocumentResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        /** @var PurchaseDocument $doc */
        $doc = $this->resource;
        $data = [
            'id' => $doc->id,
            'document_type' => $doc instanceof PurchaseInvoice && $doc->isDebitNote() ? 'purchase_debit_note' : $doc::kind()->value,
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
            'warehouse_id' => $doc->warehouse_id,
            'cost_center_id' => $doc->cost_center_id,
            'project_id' => $doc->project_id,
            'notes' => $doc->notes,
            'internal_notes' => $doc->internal_notes,
            'source_type' => $doc->source_type,
            'source_id' => $doc->source_id,
        ];

        foreach (PurchaseDocument::TOTALS as $column) {
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
            $bounds = app(Quantities::class)->returnable($doc);
            foreach ($doc->lines as $line) {
                if (isset($bounds[$line->id])) {
                    $line->setAttribute('returnable_quantity', $bounds[$line->id]);
                }
            }
            $data['lines'] = LineResource::collection($doc->lines)->resolve($request);
        }

        return $data;
    }

    /** @return array<string, mixed> */
    private function specific(PurchaseDocument $doc): array
    {
        return match (true) {
            $doc instanceof PurchaseOrder => [
                'expected_date' => $doc->expected_date?->format('Y-m-d'), 'supplier_reference' => $doc->supplier_reference,
                'request_id' => $doc->request_id, 'rfq_id' => $doc->rfq_id, 'revision' => $doc->revision,
                'approval_request_id' => $doc->approval_request_id, 'approval_comment' => $doc->approval_comment,
                'approved_at' => self::time($doc->approved_at), 'approved_by' => $doc->approved_by, 'sent_at' => self::time($doc->sent_at),
                'cancelled_at' => self::time($doc->cancelled_at), 'closed_at' => self::time($doc->closed_at),
            ],
            $doc instanceof PurchaseReceipt => [
                'order_id' => $doc->order_id, 'invoice_id' => $doc->invoice_id, 'supplier_reference' => $doc->supplier_reference,
                'stock_document_id' => $doc->stock_document_id, 'journal_entry_id' => $doc->journal_entry_id, 'cost_total' => (string) $doc->cost_total,
                'posted_at' => self::time($doc->posted_at), 'posted_by' => $doc->posted_by, 'cancelled_at' => self::time($doc->cancelled_at),
                'cancel_reason' => $doc->cancel_reason, 'reversal_stock_document_id' => $doc->reversal_stock_document_id,
                'reversal_date' => $doc->reversal_date?->format('Y-m-d'),
            ],
            $doc instanceof PurchaseInvoice => [
                'invoice_type' => $doc->invoice_type->value, 'supplier_invoice_no' => $doc->supplier_invoice_no, 'order_id' => $doc->order_id,
                'receipt_id' => $doc->receipt_id, 'return_id' => $doc->return_id, 'original_invoice_id' => $doc->original_invoice_id,
                'receive_on_invoice' => $doc->receive_on_invoice, 'journal_entry_id' => $doc->journal_entry_id,
                'reversal_journal_entry_id' => $doc->reversal_journal_entry_id, 'payable_total' => (string) $doc->payable()->toScale(4),
                'paid_amount' => (string) $doc->paid_amount, 'balance_due' => (string) $doc->balance_due, 'match_status' => $doc->match_status,
                'match_override_reason' => $doc->match_override_reason, 'match_override_by' => $doc->match_override_by,
                'approval_request_id' => $doc->approval_request_id, 'approval_comment' => $doc->approval_comment, 'approved_at' => self::time($doc->approved_at),
                'booked_at' => self::time($doc->booked_at), 'booked_by' => $doc->booked_by, 'reversed_at' => self::time($doc->reversed_at),
                'reversal_date' => $doc->reversal_date?->format('Y-m-d'), 'reversal_reason' => $doc->reversal_reason,
                'e_document_status' => $doc->e_document_status, 'e_document_uuid' => $doc->e_document_uuid,
            ],
            $doc instanceof PurchaseReturn => [
                'invoice_id' => $doc->invoice_id, 'receipt_id' => $doc->receipt_id, 'reason' => $doc->reason, 'stock_document_id' => $doc->stock_document_id,
                'journal_entry_id' => $doc->journal_entry_id, 'debit_invoice_id' => $doc->debit_invoice_id,
                'approved_at' => self::time($doc->approved_at), 'shipped_at' => self::time($doc->shipped_at),
                'debited_at' => self::time($doc->debited_at), 'cancelled_at' => self::time($doc->cancelled_at),
            ],
            default => [],
        };
    }

    private static function time(?Carbon $value): ?string
    {
        return $value?->toIso8601String();
    }
}
