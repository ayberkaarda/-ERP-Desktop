<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Services;

use App\Core\Company\CompanyContext;
use App\Modules\Purchasing\Contracts\PurchaseInvoiceLookup;
use App\Modules\Purchasing\Data\PurchaseInvoiceData;
use App\Modules\Purchasing\Enums\InvoiceStatus;
use App\Modules\Purchasing\Models\PurchaseInvoice;
use Illuminate\Support\Str;

final class InvoiceDirectory implements PurchaseInvoiceLookup
{
    // The company context is resolved per call (no retained context).

    public function find(string $id): ?PurchaseInvoiceData
    {
        $invoice = Str::isUuid($id) ? PurchaseInvoice::query()->find($id) : null;

        return $invoice === null ? null : PurchaseInvoiceData::of($invoice);
    }

    public function openForParty(string $companyId, string $partyId): array
    {
        return app(CompanyContext::class)->runAs($companyId, fn (): array => array_values(PurchaseInvoice::query()
            ->where('party_id', $partyId)->whereIn('status', InvoiceStatus::open())->where('balance_due', '>', 0)
            ->orderBy('due_date')->orderBy('document_date')->orderBy('id')->get()
            ->map(static fn (PurchaseInvoice $i): PurchaseInvoiceData => PurchaseInvoiceData::of($i))->all()));
    }
}
