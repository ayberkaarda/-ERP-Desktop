<?php

declare(strict_types=1);

namespace App\Modules\Sales\Services;

use App\Modules\Catalog\Contracts\ItemLookup;
use App\Modules\Catalog\Contracts\UnitLookup;
use App\Modules\Organization\Contracts\CompanyDirectory;
use App\Modules\Sales\Http\Resources\DocumentResource;
use App\Modules\Sales\Models\SalesDeliveryLine;
use App\Modules\Sales\Models\SalesDocument;
use App\Modules\Sales\Models\SalesInvoice;
use App\Modules\Sales\Models\SalesReturnLine;
use Brick\Math\BigDecimal;
use Illuminate\Http\Request;

/**
 * Structured print data of a document (no PDF engine; the UI prints with browser CSS): company,
 * party snapshot, lines with item code/name and unit code, tax breakdown per rate and totals.
 */
final class PrintModel
{
    public function __construct(
        private readonly ItemLookup $items,
        private readonly UnitLookup $units,
        private readonly CompanyDirectory $companies,
    ) {}

    /** @return array<string, mixed> */
    public function build(SalesDocument $doc, Request $request): array
    {
        $doc->loadMissing('lines');
        $items = [];
        $units = [];
        $lines = [];
        $taxes = [];

        foreach ($doc->lines as $line) {
            $item = $items[$line->item_id] ??= $this->items->find($line->item_id);
            $unit = $units[$line->unit_id] ??= $this->units->find($line->unit_id);
            $lines[] = [
                'line_no' => $line->line_no,
                'item_code' => $item?->code,
                'item_name' => $item?->name,
                'description' => $line->description,
                'quantity' => (string) $line->quantity,
                'unit_code' => $unit?->code,
                'unit_name' => $unit?->name,
                'unit_price' => (string) $line->unit_price,
                'discount_percent' => (string) $line->discount_percent,
                'discount_amount' => (string) $line->line_discount,
                'net_amount' => (string) $line->net_amount,
                'tax_rate' => (string) $line->tax_rate,
                'tax_amount' => (string) $line->tax_amount,
                'line_total' => (string) $line->line_total,
                'lot_no' => $line instanceof SalesDeliveryLine || $line instanceof SalesReturnLine ? $line->lot_no : null,
                'serial_numbers' => $line instanceof SalesDeliveryLine || $line instanceof SalesReturnLine ? $line->serial_numbers : [],
            ];
            $key = (string) $line->tax_rate;
            $taxes[$key] ??= ['rate' => $key, 'base' => BigDecimal::zero(), 'tax' => BigDecimal::zero()];
            $taxes[$key]['base'] = $taxes[$key]['base']->plus($line->net_amount);
            $taxes[$key]['tax'] = $taxes[$key]['tax']->plus($line->tax_amount);
        }

        $company = null;
        $user = $request->user();

        if ($user !== null) {
            foreach ($this->companies->companiesFor((string) $user->getAuthIdentifier()) as $row) {
                if ($row['id'] === $doc->company_id) {
                    $company = $row;
                }
            }
        }

        $header = (new DocumentResource($doc->withoutRelations()))->resolve($request);

        return [
            'document_type' => $doc instanceof SalesInvoice && $doc->isCreditNote() ? 'sales_credit_note' : $doc::kind()->value,
            'company' => $company ?? ['id' => $doc->company_id, 'name' => null],
            'document' => $header,
            'party' => [
                'id' => $doc->party_id, 'name' => $doc->party_name, 'tax_office' => $doc->party_tax_office,
                'tax_number' => $doc->party_tax_number, 'billing_address' => $doc->billing_address,
            ],
            'lines' => $lines,
            'taxes' => array_values(array_map(static fn (array $t): array => [
                'rate' => $t['rate'], 'base' => (string) $t['base']->toScale(2), 'tax' => (string) $t['tax']->toScale(2),
            ], $taxes)),
            'totals' => array_intersect_key($header, array_flip(SalesDocument::TOTALS)),
        ];
    }
}
