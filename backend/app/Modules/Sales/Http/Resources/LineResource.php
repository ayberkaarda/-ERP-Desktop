<?php

declare(strict_types=1);

namespace App\Modules\Sales\Http\Resources;

use App\Modules\Sales\Models\SalesDeliveryLine;
use App\Modules\Sales\Models\SalesInvoiceLine;
use App\Modules\Sales\Models\SalesLine;
use App\Modules\Sales\Models\SalesOrderLine;
use App\Modules\Sales\Models\SalesReturnLine;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin SalesLine
 */
final class LineResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        /** @var SalesLine $line */
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
            'line_total' => (string) $line->line_total,
            'warehouse_id' => $line->warehouse_id,
            'source_line_id' => $line->source_line_id,
            'price_source' => $line->price_source,
        ];

        return match (true) {
            $line instanceof SalesOrderLine => [...$data,
                'delivered_quantity' => (string) $line->delivered_quantity,
                'invoiced_quantity' => (string) $line->invoiced_quantity,
                'reservation_id' => $line->reservation_id,
            ],
            $line instanceof SalesDeliveryLine => [...$data,
                'order_line_id' => $line->order_line_id,
                'lot_no' => $line->lot_no,
                'serial_numbers' => $line->serial_numbers,
                'unit_cost' => $line->unit_cost === null ? null : (string) $line->unit_cost,
                'cost_total' => $line->cost_total === null ? null : (string) $line->cost_total,
            ],
            $line instanceof SalesInvoiceLine => [...$data,
                'order_line_id' => $line->order_line_id,
                'delivery_line_id' => $line->delivery_line_id,
                'original_line_id' => $line->original_line_id,
            ],
            $line instanceof SalesReturnLine => [...$data,
                'invoice_line_id' => $line->invoice_line_id,
                'delivery_line_id' => $line->delivery_line_id,
                'lot_no' => $line->lot_no,
                'serial_numbers' => $line->serial_numbers,
                'unit_cost' => $line->unit_cost === null ? null : (string) $line->unit_cost,
                'cost_total' => $line->cost_total === null ? null : (string) $line->cost_total,
            ],
            default => $data,
        };
    }
}
