<?php

declare(strict_types=1);

namespace App\Modules\Sales\Services;

use App\Modules\Catalog\Contracts\ItemLookup;
use App\Modules\Catalog\Contracts\UnitLookup;
use App\Modules\Reference\Contracts\TaxCodeLookup;
use App\Modules\Sales\Contracts\EDocumentSources;
use App\Modules\Sales\Data\EDocumentSource;
use App\Modules\Sales\Enums\InvoiceStatus;
use App\Modules\Sales\Models\SalesDelivery;
use App\Modules\Sales\Models\SalesDocument;
use App\Modules\Sales\Models\SalesInvoice;
use App\Modules\Sales\Models\SalesLine;

final readonly class EDocumentSourceReader implements EDocumentSources
{
    public function __construct(private ItemLookup $items, private UnitLookup $units, private TaxCodeLookup $taxes) {}

    public function snapshot(string $type, string $id, bool $lock = false): EDocumentSource
    {
        $query = $type === 'delivery' ? SalesDelivery::query() : SalesInvoice::query();
        if ($lock) {
            $query->lockForUpdate();
        }
        /** @var SalesDelivery|SalesInvoice $document */
        $document = $query->findOrFail($id);
        $eligible = $document instanceof SalesInvoice ? in_array($document->status->value, InvoiceStatus::booked(), true) : $document->status->value === 'posted';
        $frozenLines = [];
        $lines = [];
        foreach ($document->lines()->get() as $line) {
            $frozenLines[] = $line->only(SalesLine::COLUMNS);
            $item = $this->items->find($line->item_id);
            $unit = $this->units->find($line->unit_id);
            $tax = $line->tax_code_id === null ? null : $this->taxes->find($line->tax_code_id, $document->document_date);
            $lines[] = ['id' => (string) $line->line_no, 'source_line_id' => $line->id, 'item_code' => $item->code ?? $line->item_id, 'name' => $line->description ?: ($item->name ?? ''), 'quantity' => (string) $line->quantity, 'unit_code' => $unit->code ?? '', 'unit_price' => (string) $line->unit_price, 'tax_inclusive' => $line->tax_inclusive, 'gross_amount' => (string) $line->gross_amount, 'net_amount' => (string) $line->net_amount, 'tax_rate' => (string) $line->tax_rate, 'tax_amount' => (string) $line->tax_amount, 'total' => (string) $line->line_total, 'discount_amount' => (string) $line->line_discount, 'tax_type_code' => $tax === null ? '0015' : match ($tax->type->value) {
                'vat','exemption' => '0015',default => 'UNSUPPORTED'
            }, 'tax_exemption_code' => $tax?->meta['exemption_code'] ?? null];
        }
        $address = $document->billing_address ?? [];
        $customer = ['name' => $document->party_name, 'tax_number' => $document->party_tax_number, 'tax_office' => $document->party_tax_office, 'address' => ['street' => (string) ($address['line1'] ?? $address['street'] ?? ''), 'district' => (string) ($address['district'] ?? ''), 'city' => (string) ($address['city'] ?? ''), 'postal_code' => (string) ($address['postal_code'] ?? ''), 'country_code' => (string) ($address['country'] ?? $address['country_code'] ?? 'TR')]];
        $payload = ['issue_date' => $document->document_date->format('Y-m-d'), 'issue_time' => '00:00:00', 'currency' => $document->currency_code, 'fx_rate' => (string) $document->fx_rate, 'invoice_type' => $document instanceof SalesInvoice && $document->isCreditNote() ? 'IADE' : 'SATIS', 'customer' => $customer, 'lines' => $lines, 'totals' => ['subtotal' => (string) $document->subtotal, 'discount' => (string) $document->discount_total, 'tax' => (string) $document->tax_total, 'total' => (string) $document->total, 'payable' => (string) $document->total], 'notes' => $document->notes, 'source' => ['module' => 'sales', 'type' => $type, 'id' => $document->id, 'version' => $document->version, 'number' => $document->number]];
        $immutable = ['number' => $document->number, 'date' => $payload['issue_date'], 'party_id' => $document->party_id, 'customer' => $customer, 'currency' => $document->currency_code, 'fx_rate' => (string) $document->fx_rate, 'totals' => $payload['totals'], 'invoice_type' => $payload['invoice_type'], 'notes' => $document->notes, 'lines' => $frozenLines];

        return new EDocumentSource($document->id, $document->version, $eligible, hash('sha256', json_encode($immutable, JSON_THROW_ON_ERROR)), $payload);
    }

    public function candidates(string $type, string $search, int $page): array
    {
        $query = $type === 'delivery' ? SalesDelivery::query()->where('status', 'posted') : SalesInvoice::query()->whereIn('status', InvoiceStatus::booked());
        if ($search !== '') {
            $term = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $search);
            $query->where(fn ($q) => $q->where('number', 'ilike', '%'.$term.'%')->orWhere('party_name', 'ilike', '%'.$term.'%'));
        }
        $rows = $query->orderByDesc('document_date')->orderBy('id')->paginate(20, ['*'], 'page', $page);

        return ['records' => array_values($rows->getCollection()->map(static fn (SalesDocument $d): array => ['id' => $d->id, 'number' => $d->number, 'document_date' => $d->document_date->format('Y-m-d'), 'party_name' => $d->party_name, 'currency_code' => $d->currency_code, 'total' => (string) $d->total, 'version' => $d->version, 'invoice_type' => $d instanceof SalesInvoice ? $d->invoice_type->value : null])->all()), 'total' => $rows->total()];
    }
}
