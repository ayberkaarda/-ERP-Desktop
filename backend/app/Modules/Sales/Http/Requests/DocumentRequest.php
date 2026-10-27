<?php

declare(strict_types=1);

namespace App\Modules\Sales\Http\Requests;

use App\Core\Sync\Rules\ClientKey;
use App\Modules\Sales\Models\SalesDocument;

/**
 * Draft create (POST) / update (PATCH with version) of a document, and the conversion payloads.
 * The route default `form` picks the shape:
 *   quote | order | delivery | invoice | return | preview  - header + lines
 *   delivery_from_order | invoice_from_delivery | invoice_from_order | return_from_invoice | quote_convert
 * Amounts are decimal strings. Business rules (prices, bounds, tax) are checked by the services.
 * A quote or order POST may carry the client's own UUIDv7 `id` (offline drafts keep their key).
 */
final class DocumentRequest extends SalesRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        $form = $this->route()?->defaults['form'] ?? 'quote';
        $patch = $this->isMethod('PATCH') || ($this->route()?->defaults['partial'] ?? false) === true;
        $max = SalesDocument::MAX_LINES;

        return match ($form) {
            'delivery_from_order' => [
                ...$this->dates(), 'warehouse_id' => ['sometimes', 'nullable', 'uuid'], 'notes' => ['sometimes', 'nullable', 'string', 'max:5000'],
                'lines' => ['sometimes', 'array', 'min:1', 'max:'.$max], 'lines.*' => ['array'],
                'lines.*.order_line_id' => ['required', 'uuid'], 'lines.*.quantity' => ['required', 'string', 'regex:'.self::QTY],
                ...$this->trackingRules(),
            ],
            'invoice_from_delivery', 'invoice_from_order' => [
                ...$this->dates(), 'due_date' => ['sometimes', 'nullable', 'date_format:Y-m-d'], 'fx_rate' => ['sometimes', 'nullable', 'string', 'regex:'.self::QTY],
                'notes' => ['sometimes', 'nullable', 'string', 'max:5000'], 'internal_notes' => ['sometimes', 'nullable', 'string', 'max:5000'],
                'deliver_on_invoice' => [$form === 'invoice_from_order' ? 'sometimes' : 'prohibited', 'boolean'],
                'lines' => ['sometimes', 'array', 'min:1', 'max:'.$max], 'lines.*' => ['array'],
                'lines.*.'.($form === 'invoice_from_order' ? 'order_line_id' : 'delivery_line_id') => ['required', 'uuid'],
                'lines.*.quantity' => ['required', 'string', 'regex:'.self::QTY],
            ],
            'return_from_invoice' => [
                ...$this->dates(), 'warehouse_id' => ['sometimes', 'nullable', 'uuid'], 'reason' => ['sometimes', 'nullable', 'string', 'max:1000'],
                'notes' => ['sometimes', 'nullable', 'string', 'max:5000'],
                'lines' => ['sometimes', 'array', 'min:1', 'max:'.$max], 'lines.*' => ['array'],
                'lines.*.invoice_line_id' => ['required', 'uuid'], 'lines.*.quantity' => ['required', 'string', 'regex:'.self::QTY],
                ...$this->trackingRules(),
            ],
            'quote_convert' => [
                ...$this->dates(), 'requested_delivery_date' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
                'warehouse_id' => ['sometimes', 'nullable', 'uuid'], ...$this->versionRules(false),
            ],
            'return' => [
                ...$this->dates(), 'warehouse_id' => ['sometimes', 'nullable', 'uuid'], 'reason' => ['sometimes', 'nullable', 'string', 'max:1000'],
                'notes' => ['sometimes', 'nullable', 'string', 'max:5000'], 'internal_notes' => ['sometimes', 'nullable', 'string', 'max:5000'],
                'lines' => ['sometimes', 'array', 'min:1', 'max:'.$max], 'lines.*' => ['array'],
                'lines.*.invoice_line_id' => ['required', 'uuid'], 'lines.*.quantity' => ['required', 'string', 'regex:'.self::QTY],
                ...$this->trackingRules(), ...$this->versionRules(true),
            ],
            default => [...$this->idRules($patch, $form), ...$this->headerRules($patch, $form), ...$this->lineRules($patch, $form, $max), ...($form === 'preview' ? [] : $this->versionRules($patch))],
        };
    }

    /**
     * Client key of a new quote or order draft: canonical UUIDv7, unused in every company
     * (the key is global, so the check is not company scoped).
     *
     * @return array<string, list<mixed>>
     */
    private function idRules(bool $patch, string $form): array
    {
        $model = $this->route()?->defaults['model'] ?? null;

        if ($patch || ! in_array($form, ['quote', 'order'], true) || ! is_string($model) || ! is_subclass_of($model, SalesDocument::class)) {
            // Not validated, so never part of validated(): edits and other forms ignore an id.
            return [];
        }

        return ['id' => ['sometimes', 'bail', new ClientKey((new $model)->getTable()), 'string']];
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
            'price_list_id' => ['sometimes', 'nullable', 'uuid'],
            'warehouse_id' => ['sometimes', 'nullable', 'uuid'],
            'cost_center_id' => ['sometimes', 'nullable', 'uuid'],
            'project_id' => ['sometimes', 'nullable', 'uuid'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'internal_notes' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'billing_address' => ['sometimes', 'nullable', 'array'],
            'billing_address.*' => ['nullable', 'string', 'max:255'],
        ];

        return match ($form) {
            'quote' => [...$rules, 'valid_until' => ['sometimes', 'nullable', 'date_format:Y-m-d']],
            'order' => [...$rules, 'requested_delivery_date' => ['sometimes', 'nullable', 'date_format:Y-m-d']],
            'invoice' => [...$rules, 'deliver_on_invoice' => ['sometimes', 'boolean']],
            'delivery' => array_diff_key($rules, ['party_id' => true]) + ['party_id' => [$patch ? 'sometimes' : 'required', 'uuid']],
            default => $rules,
        };
    }

    /**
     * @return array<string, list<mixed>>
     */
    private function lineRules(bool $patch, string $form, int $max): array
    {
        $sourced = in_array($form, ['invoice', 'delivery'], true);
        $itemRule = ['uuid'];

        if ($form === 'invoice') {
            array_unshift($itemRule, 'required_without_all:lines.*.delivery_line_id,lines.*.order_line_id');
        } elseif ($form === 'delivery') {
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
            'lines.*.tax_inclusive' => ['sometimes', 'boolean'],
            'lines.*.description' => ['sometimes', 'nullable', 'string', 'max:500'],
            'lines.*.warehouse_id' => ['sometimes', 'nullable', 'uuid'],
        ];

        if (in_array($form, ['quote', 'order'], true)) {
            // Id of a stored line of the edited draft (keeps its identity and provenance).
            $rules['lines.*.id'] = ['sometimes', 'nullable', 'uuid', 'distinct'];
        }

        if ($sourced && $form === 'invoice') {
            $rules['lines.*.delivery_line_id'] = ['sometimes', 'nullable', 'uuid'];
            $rules['lines.*.order_line_id'] = ['sometimes', 'nullable', 'uuid'];
        }

        if ($form === 'delivery') {
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
            'lines.*.serial_numbers' => ['sometimes', 'array', 'max:10000'],
            'lines.*.serial_numbers.*' => ['string', 'max:100'],
        ];
    }

    /** @return array<string, list<string>> */
    private function dates(): array
    {
        return ['document_date' => ['sometimes', 'date_format:Y-m-d']];
    }

    /**
     * Validated header fields (lines and version removed).
     *
     * @return array<string, mixed>
     */
    public function headerData(): array
    {
        return collect($this->validated())->except(['lines', 'version'])->all();
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
