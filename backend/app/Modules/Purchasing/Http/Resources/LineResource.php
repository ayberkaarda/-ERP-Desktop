<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Http\Resources;

use App\Modules\Purchasing\Models\PurchaseInvoiceLine;
use App\Modules\Purchasing\Models\PurchaseLine;
use App\Modules\Purchasing\Models\PurchaseOrderLine;
use App\Modules\Purchasing\Models\PurchaseReceiptLine;
use App\Modules\Purchasing\Models\PurchaseReturnLine;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin PurchaseLine
 */
final class LineResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        /** @var PurchaseLine $line */
        $line = $this->resource;
        $data = [
            'id' => $line->id,
            'line_no' => $line->line_no,
            'item_id' => $line->item_id,
            'variant_id' => $line->variant_id,
            'item_type' => $line->item_type,
            'description' => $line->description,
            'quantity' => (string) $line->quantity,
            'unit_id' => $line->unit_id,
            'base_quantity' => (string) $line->base_quantity,
            'unit_price' => (string) $line->unit_price,
            'tax_inclusive' => $line->tax_inclusive,
            'discount_percent' => (string) $line->discount_percent,
            'discount_amount' => (string) $line->discount_amount,
            'gross_amount' => (string) $line->gross_amount,
            'line_discount' => (string) $line->line_discount,
            'net_amount' => (string) $line->net_amount,
            'tax_code_id' => $line->tax_code_id,
            'tax_rate' => (string) $line->tax_rate,
            'tax_amount' => (string) $line->tax_amount,
            'withholding_code_id' => $line->withholding_code_id,
            'withholding_rate' => (string) $line->withholding_rate,
            'withholding_amount' => (string) $line->withholding_amount,
            'line_total' => (string) $line->line_total,
            'warehouse_id' => $line->warehouse_id,
            'source_line_id' => $line->source_line_id,
            'price_source' => $line->price_source,
        ];

        return match (true) {
            $line instanceof PurchaseOrderLine => [...$data,
                'received_quantity' => (string) $line->received_quantity,
                'invoiced_quantity' => (string) $line->invoiced_quantity,
                'request_line_id' => $line->request_line_id,
                'rfq_line_id' => $line->rfq_line_id,
                'expected_date' => $line->expected_date?->format('Y-m-d'),
            ],
            $line instanceof PurchaseReceiptLine => [...$data,
                'order_line_id' => $line->order_line_id,
                'lot_no' => $line->lot_no,
                'expiry_date' => $line->expiry_date?->format('Y-m-d'),
                'serial_numbers' => $line->serial_numbers,
                'location_id' => $line->location_id,
                'unit_cost' => $line->unit_cost === null ? null : (string) $line->unit_cost,
                'cost_total' => $line->cost_total === null ? null : (string) $line->cost_total,
            ],
            $line instanceof PurchaseInvoiceLine => [...$data,
                'order_line_id' => $line->order_line_id,
                'receipt_line_id' => $line->receipt_line_id,
                'original_line_id' => $line->original_line_id,
                'match_status' => $line->match_status,
                'match_details' => $line->match_details,
                'net_local' => (string) $line->net_local,
                'grni_amount' => (string) $line->grni_amount,
                'variance_amount' => (string) $line->variance_amount,
                'expense_amount' => (string) $line->expense_amount,
            ],
            $line instanceof PurchaseReturnLine => [...$data,
                'invoice_line_id' => $line->invoice_line_id,
                'receipt_line_id' => $line->receipt_line_id,
                'lot_no' => $line->lot_no,
                'serial_numbers' => $line->serial_numbers,
                'unit_cost' => $line->unit_cost === null ? null : (string) $line->unit_cost,
                'cost_total' => $line->cost_total === null ? null : (string) $line->cost_total,
                'receipt_cost' => $line->receipt_cost === null ? null : (string) $line->receipt_cost,
            ],
            default => $data,
        };
    }
}
