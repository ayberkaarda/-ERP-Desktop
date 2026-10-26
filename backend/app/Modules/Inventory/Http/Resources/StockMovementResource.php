<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Resources;

use App\Modules\Inventory\Support\Stock;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One ledger row. signed_quantity is negative for outbound movements.
 *
 * @property object $resource
 */
final class StockMovementResource extends JsonResource
{
    /** @return array{id: string, seq: int, item_id: string, item_code: string|null, item_name: string|null, warehouse_id: string, location_id: string|null, lot_id: string|null, lot_no: string|null, serial_id: string|null, serial_no: string|null, movement_type: string, direction: string, quantity: string, signed_quantity: string, unit_cost: string, total_cost: string, occurred_at: string, document_type: string, document_id: string, document_number: string|null, document_doc_type: string|null, document_line_id: string|null, journal_entry_id: string|null, reverses_id: string|null, created_by: string|null, created_at: string|null} */
    public function toArray(Request $request): array
    {
        $r = $this->resource;
        $text = static fn (string $key): ?string => isset($r->{$key}) && is_scalar($r->{$key}) ? (string) $r->{$key} : null;
        $qty = Stock::qty($text('quantity') ?? '0');

        return [
            'id' => (string) $text('id'),
            'seq' => (int) $text('seq'),
            'item_id' => (string) $text('item_id'),
            'item_code' => $text('item_code'),
            'item_name' => $text('item_name'),
            'warehouse_id' => (string) $text('warehouse_id'),
            'location_id' => $text('location_id'),
            'lot_id' => $text('lot_id'),
            'lot_no' => $text('lot_no'),
            'serial_id' => $text('serial_id'),
            'serial_no' => $text('serial_no'),
            'movement_type' => (string) $text('movement_type'),
            'direction' => (string) $text('direction'),
            'quantity' => $qty,
            'signed_quantity' => $text('direction') === 'out' ? '-'.$qty : $qty,
            'unit_cost' => (string) Stock::dec($text('unit_cost') ?? '0')->toScale(6),
            'total_cost' => (string) Stock::money($text('total_cost') ?? '0'),
            'occurred_at' => (string) $text('occurred_at'),
            'document_type' => (string) $text('document_type'),
            'document_id' => (string) $text('document_id'),
            'document_number' => $text('document_number'),
            'document_doc_type' => $text('document_doc_type'),
            'document_line_id' => $text('document_line_id'),
            'journal_entry_id' => $text('journal_entry_id'),
            'reverses_id' => $text('reverses_id'),
            'created_by' => $text('created_by'),
            'created_at' => $text('created_at'),
        ];
    }
}
