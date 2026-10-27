<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Http\Requests;

use App\Core\Sync\Rules\ClientKey;
use App\Modules\Purchasing\Models\PurchaseDocument;

/**
 * Draft create (POST) / update (PATCH with version) of a document, and the conversion payloads.
 * The route default `form` picks the shape:
 *   request | rfq | order | receipt | invoice | return | preview          - header + lines
 *   request_rfq | request_order | rfq_quote | rfq_award | receipt_from_order | invoice_from_receipt |
 *   invoice_from_order | return_from_invoice | return_from_receipt         - conversions and actions
 * Amounts are decimal strings. Business rules (prices, bounds, tax) are checked by the services.
 */
final class DocumentRequest extends PurchasingRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        $form = $this->route()?->defaults['form'] ?? 'order';
        $patch = $this->isMethod('PATCH') || ($this->route()?->defaults['partial'] ?? false) === true;
        $max = PurchaseDocument::MAX_LINES;
        $date = ['document_date' => ['sometimes', 'date_format:Y-m-d']];
        $notes = ['notes' => ['sometimes', 'nullable', 'string', 'max:5000'], 'internal_notes' => ['sometimes', 'nullable', 'string', 'max:5000']];
        $optionalLines = ['lines' => ['sometimes', 'array', 'min:1', 'max:'.$max], 'lines.*' => ['array'], 'lines.*.quantity' => ['required', 'string', 'regex:'.self::QTY]];

        return match ($form) {
            'request' => [
                ...$date, ...$notes, 'needed_by' => ['sometimes', 'nullable', 'date_format:Y-m-d'], 'warehouse_id' => ['sometimes', 'nullable', 'uuid'],
                'cost_center_id' => ['sometimes', 'nullable', 'uuid'], 'project_id' => ['sometimes', 'nullable', 'uuid'],
                'lines' => [$patch ? 'sometimes' : 'required', 'array', 'min:1', 'max:'.$max], 'lines.*' => ['array'],
                'lines.*.item_id' => ['required', 'uuid'], 'lines.*.variant_id' => ['sometimes', 'nullable', 'uuid'], 'lines.*.unit_id' => ['sometimes', 'nullable', 'uuid'],
                'lines.*.quantity' => ['required', 'string', 'regex:'.self::QTY], 'lines.*.estimated_price' => ['sometimes', 'nullable', 'string', 'regex:'.self::QTY],
                'lines.*.suggested_supplier_id' => ['sometimes', 'nullable', 'uuid'], 'lines.*.needed_by' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
                'lines.*.warehouse_id' => ['sometimes', 'nullable', 'uuid'], 'lines.*.description' => ['sometimes', 'nullable', 'string', 'max:500'],
                ...$this->versionRules($patch), ...$this->clientIdRules($patch, 'purchase_requests'),
            ],
            'request_rfq' => [
                ...$date, 'notes' => ['sometimes', 'nullable', 'string', 'max:5000'], 'response_due' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
                'currency_code' => ['sometimes', 'nullable', 'string', 'regex:/^[A-Z]{3}$/'], 'warehouse_id' => ['sometimes', 'nullable', 'uuid'],
                'supplier_ids' => ['sometimes', 'array', 'max:100'], 'supplier_ids.*' => ['uuid', 'distinct'],
                ...$optionalLines, 'lines.*.request_line_id' => ['required', 'uuid'],
            ],
            'request_order' => [
                ...$date, 'notes' => ['sometimes', 'nullable', 'string', 'max:5000'], 'party_id' => ['sometimes', 'uuid'],
                'expected_date' => ['sometimes', 'nullable', 'date_format:Y-m-d'], 'currency_code' => ['sometimes', 'nullable', 'string', 'regex:/^[A-Z]{3}$/'],
                'warehouse_id' => ['sometimes', 'nullable', 'uuid'],
                ...$optionalLines, 'lines.*.request_line_id' => ['required', 'uuid'], 'lines.*.unit_price' => ['sometimes', 'nullable', 'string', 'regex:'.self::QTY],
            ],
            'rfq' => [
                ...$date, ...$notes, 'response_due' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
                'currency_code' => ['sometimes', 'nullable', 'string', 'regex:/^[A-Z]{3}$/'], 'warehouse_id' => ['sometimes', 'nullable', 'uuid'],
                'supplier_ids' => ['sometimes', 'array', 'max:100'], 'supplier_ids.*' => ['uuid', 'distinct'],
                'lines' => [$patch ? 'sometimes' : 'required', 'array', 'min:1', 'max:'.$max], 'lines.*' => ['array'],
                'lines.*.item_id' => ['required', 'uuid'], 'lines.*.variant_id' => ['sometimes', 'nullable', 'uuid'], 'lines.*.unit_id' => ['sometimes', 'nullable', 'uuid'],
                'lines.*.quantity' => ['required', 'string', 'regex:'.self::QTY], 'lines.*.description' => ['sometimes', 'nullable', 'string', 'max:500'],
                'lines.*.needed_by' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
                ...$this->versionRules($patch),
            ],
            'rfq_quote' => [
                'party_id' => ['sometimes', 'uuid'], 'declined' => ['sometimes', 'boolean'],
                'quotes' => ['sometimes', 'array', 'max:'.$max], 'quotes.*' => ['array'],
                'quotes.*.rfq_line_id' => ['required', 'uuid'], 'quotes.*.unit_price' => ['required', 'string', 'regex:'.self::QTY],
                'quotes.*.discount_percent' => ['sometimes', 'nullable', 'string', 'regex:'.self::PERCENT],
                'quotes.*.lead_time_days' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:3650'],
                'quotes.*.valid_until' => ['sometimes', 'nullable', 'date_format:Y-m-d'], 'quotes.*.notes' => ['sometimes', 'nullable', 'string', 'max:1000'],
                ...$this->versionRules(false),
            ],
            'rfq_award' => [
                ...$date, 'party_id' => ['sometimes', 'uuid'], 'expected_date' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
                'warehouse_id' => ['sometimes', 'nullable', 'uuid'],
                'lines' => ['sometimes', 'array', 'min:1', 'max:'.$max], 'lines.*' => ['array'],
                'lines.*.rfq_line_id' => ['required', 'uuid'], 'lines.*.party_id' => ['required', 'uuid'],
                ...$this->versionRules(false),
            ],
            'receipt_from_order' => [
                ...$date, 'notes' => ['sometimes', 'nullable', 'string', 'max:5000'], 'warehouse_id' => ['sometimes', 'nullable', 'uuid'],
                'supplier_reference' => ['sometimes', 'nullable', 'string', 'max:100'], 'fx_rate' => ['sometimes', 'nullable', 'string', 'regex:'.self::QTY],
                ...$optionalLines, 'lines.*.order_line_id' => ['required', 'uuid'], ...$this->trackingRules(),
            ],
            'invoice_from_receipt', 'invoice_from_order' => [
                ...$date, ...$notes, 'due_date' => ['sometimes', 'nullable', 'date_format:Y-m-d'], 'fx_rate' => ['sometimes', 'nullable', 'string', 'regex:'.self::QTY],
                'supplier_invoice_no' => ['sometimes', 'nullable', 'string', 'max:64'],
                'receive_on_invoice' => [$form === 'invoice_from_order' ? 'sometimes' : 'prohibited', 'boolean'],
                ...$optionalLines,
                'lines.*.'.($form === 'invoice_from_order' ? 'order_line_id' : 'receipt_line_id') => ['required', 'uuid'],
                'lines.*.unit_price' => ['sometimes', 'nullable', 'string', 'regex:'.self::QTY],
            ],
            'return_from_invoice', 'return_from_receipt' => [
                ...$date, 'warehouse_id' => ['sometimes', 'nullable', 'uuid'], 'reason' => ['sometimes', 'nullable', 'string', 'max:1000'],
                'notes' => ['sometimes', 'nullable', 'string', 'max:5000'],
                ...$optionalLines, 'lines.*.'.($form === 'return_from_invoice' ? 'invoice_line_id' : 'receipt_line_id') => ['required', 'uuid'],
                'lines.*.lot_no' => ['sometimes', 'nullable', 'string', 'max:64'], 'lines.*.serial_numbers' => ['sometimes', 'array', 'max:10000'],
                'lines.*.serial_numbers.*' => ['string', 'max:100'],
            ],
            'return' => [
                ...$date, ...$notes, 'warehouse_id' => ['sometimes', 'nullable', 'uuid'], 'reason' => ['sometimes', 'nullable', 'string', 'max:1000'],
                ...$optionalLines, 'lines.*.invoice_line_id' => ['required_without:lines.*.receipt_line_id', 'nullable', 'uuid'],
                'lines.*.receipt_line_id' => ['required_without:lines.*.invoice_line_id', 'nullable', 'uuid'],
                'lines.*.lot_no' => ['sometimes', 'nullable', 'string', 'max:64'], 'lines.*.serial_numbers' => ['sometimes', 'array', 'max:10000'],
                'lines.*.serial_numbers.*' => ['string', 'max:100'],
                ...$this->versionRules(true),
            ],
            default => [...$this->headerRules($patch, $form), ...$this->lineRules($patch, $form, $max), ...($form === 'preview' ? [] : $this->versionRules($patch))],
        };
    }

    /**
     * A draft created offline carries its own primary key (UUIDv7, not taken); a PATCH never sets it.
     *
     * @return array<string, list<mixed>>
     */
    private function clientIdRules(bool $patch, string $table): array
    {
        return $patch ? [] : ['id' => ['sometimes', 'bail', new ClientKey($table), 'string']];
    }

    /**
     * @return array<string, list<mixed>>
     */
    private function headerRules(bool $patch, string $form): array
    {
        $rules = [
            'document_date' => ['sometimes', 'date_format:Y-m-d'],
            'party_id' => [$patch ? 'sometimes' : 'required', 'uuid'],
            'currency_code' => ['sometimes', 'nullable', 'string', 'regex:/^[A-Z]{3}$/'],
            'fx_rate' => ['sometimes', 'nullable', 'string', 'regex:'.self::QTY],
            'payment_term_id' => ['sometimes', 'nullable', 'uuid'],
            'due_date' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'warehouse_id' => ['sometimes', 'nullable', 'uuid'],
            'cost_center_id' => ['sometimes', 'nullable', 'uuid'],
            'project_id' => ['sometimes', 'nullable', 'uuid'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'internal_notes' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'billing_address' => ['sometimes', 'nullable', 'array'],
            'billing_address.*' => ['nullable', 'string', 'max:255'],
        ];

        return match ($form) {
            'order' => [...$rules, 'expected_date' => ['sometimes', 'nullable', 'date_format:Y-m-d'], 'supplier_reference' => ['sometimes', 'nullable', 'string', 'max:100']],
            'receipt' => [...$rules, 'supplier_reference' => ['sometimes', 'nullable', 'string', 'max:100']],
            'invoice' => [...$rules, 'receive_on_invoice' => ['sometimes', 'boolean'], 'supplier_invoice_no' => ['sometimes', 'nullable', 'string', 'max:64']],
            default => $rules,
        };
    }

    /**
     * @return array<string, list<mixed>>
     */
    private function lineRules(bool $patch, string $form, int $max): array
    {
        $itemRule = ['uuid'];

        if ($form === 'invoice') {
            array_unshift($itemRule, 'required_without_all:lines.*.receipt_line_id,lines.*.order_line_id');
        } elseif ($form === 'receipt') {
            array_unshift($itemRule, 'required_without:lines.*.order_line_id');
        } else {
            array_unshift($itemRule, 'required');
        }

        $rules = [
            'lines' => [$patch ? 'sometimes' : 'required', 'array', 'min:1', 'max:'.$max],
            'lines.*' => ['array'],
            'lines.*.item_id' => $itemRule,
            'lines.*.variant_id' => ['sometimes', 'nullable', 'uuid'],
            'lines.*.unit_id' => ['sometimes', 'nullable', 'uuid'],
            'lines.*.quantity' => ['required', 'string', 'regex:'.self::QTY],
            'lines.*.unit_price' => ['sometimes', 'nullable', 'string', 'regex:'.self::QTY],
            'lines.*.discount_percent' => ['sometimes', 'nullable', 'string', 'regex:'.self::PERCENT],
            'lines.*.discount_amount' => ['sometimes', 'nullable', 'string', 'regex:'.self::MONEY],
            'lines.*.tax_code_id' => ['sometimes', 'nullable', 'uuid'],
            'lines.*.withholding_code_id' => ['sometimes', 'nullable', 'uuid'],
            'lines.*.tax_inclusive' => ['sometimes', 'boolean'],
            'lines.*.description' => ['sometimes', 'nullable', 'string', 'max:500'],
            'lines.*.warehouse_id' => ['sometimes', 'nullable', 'uuid'],
        ];

        if ($form === 'order') {
            // Id of a stored line of the edited draft (keeps its identity and provenance).
            $rules['lines.*.id'] = ['sometimes', 'nullable', 'uuid', 'distinct'];
            $rules['lines.*.expected_date'] = ['sometimes', 'nullable', 'date_format:Y-m-d'];
        }

        if ($form === 'invoice') {
            $rules['lines.*.receipt_line_id'] = ['sometimes', 'nullable', 'uuid'];
            $rules['lines.*.order_line_id'] = ['sometimes', 'nullable', 'uuid'];
        }

        if ($form === 'receipt') {
            $rules['lines.*.order_line_id'] = ['sometimes', 'nullable', 'uuid'];
            $rules += $this->trackingRules();
        }

        return $rules;
    }

    /** @return array<string, list<string>> */
    private function trackingRules(): array
    {
        return [
            'lines.*.lot_no' => ['sometimes', 'nullable', 'string', 'max:64'],
            'lines.*.expiry_date' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'lines.*.serial_numbers' => ['sometimes', 'array', 'max:10000'],
            'lines.*.serial_numbers.*' => ['string', 'max:100'],
            'lines.*.location_id' => ['sometimes', 'nullable', 'uuid'],
        ];
    }

    /**
     * Validated header fields (id, lines and version removed).
     *
     * @return array<string, mixed>
     */
    public function headerData(): array
    {
        return collect($this->validated())->except(['id', 'lines', 'version'])->all();
    }

    /** The client-generated primary key of a created draft, when one was sent. */
    public function clientId(): ?string
    {
        $id = $this->validated('id');

        return is_string($id) ? $id : null;
    }

    /**
     * Validated lines with the keys the client sent (an explicit null tax code stays null).
     *
     * @return list<array<string, mixed>>|null
     */
    public function lineData(): ?array
    {
        $lines = $this->validated('lines');

        return is_array($lines) ? array_values(array_map(static fn (mixed $l): array => is_array($l) ? $l : [], $lines)) : null;
    }
}
