<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Requests;

use App\Modules\Inventory\Enums\DocumentType;
use App\Modules\Inventory\Models\StockDocument;
use App\Modules\Inventory\Services\Ledger\StockLedger;
use Illuminate\Validation\Rule;

/**
 * Draft create/update. Quantities and costs are decimal strings; stock rules (availability, lots,
 * serials, expiry) are checked when the document is posted. Count documents take a snapshot of the
 * warehouse when created (freeze, default true; item_ids narrows it) and their counted quantities
 * change through PATCH /stock-documents/{id}/counts.
 */
final class StockDocumentRequest extends InventoryRequest
{
    protected function gate(): array
    {
        return [$this->creating() ? 'create' : 'update', StockDocument::class];
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $qty = ['sometimes', 'nullable', 'string', 'regex:'.self::QTY];

        return [
            'doc_type' => [$this->required(), Rule::in(DocumentType::values())],
            'document_date' => [$this->required(), 'date_format:Y-m-d'],
            'warehouse_id' => [$this->required(), 'uuid'],
            'target_warehouse_id' => ['sometimes', 'nullable', 'uuid'],
            'reason' => ['sometimes', 'nullable', 'string', 'max:500'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'offset_event' => ['sometimes', 'nullable', Rule::in(StockLedger::OFFSET_EVENTS)],
            'allow_expired' => ['sometimes', 'boolean'],
            'freeze' => [$this->creating() ? 'sometimes' : 'prohibited', 'boolean'],
            'item_ids' => [$this->creating() ? 'sometimes' : 'prohibited', 'array', 'max:'.StockDocument::MAX_LINES],
            'item_ids.*' => ['uuid'],
            'lines' => [$this->creating() ? 'required_unless:doc_type,count' : 'sometimes', 'array', 'max:'.StockDocument::MAX_LINES],
            'lines.*' => ['array'],
            'lines.*.item_id' => ['required', 'uuid'],
            'lines.*.unit_id' => ['sometimes', 'nullable', 'uuid'],
            'lines.*.quantity' => $qty,
            'lines.*.unit_cost' => $qty,
            'lines.*.lot_no' => ['sometimes', 'nullable', 'string', 'max:64'],
            'lines.*.expiry_date' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'lines.*.serial_numbers' => ['sometimes', 'array', 'max:10000'],
            'lines.*.serial_numbers.*' => ['string', 'max:100'],
            'lines.*.location_id' => ['sometimes', 'nullable', 'uuid'],
            'lines.*.target_location_id' => ['sometimes', 'nullable', 'uuid'],
            'lines.*.direction' => ['sometimes', 'nullable', 'in:in,out'],
            'lines.*.counted_quantity' => $qty,
            'lines.*.notes' => ['sometimes', 'nullable', 'string', 'max:500'],
            'lines.*.reservation_id' => ['sometimes', 'nullable', 'uuid'],
            'version' => $this->versionRule(),
        ];
    }
}
