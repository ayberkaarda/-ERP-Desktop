<?php

declare(strict_types=1);

namespace App\Modules\Sales\Services;

use App\Core\Company\CompanyContext;
use App\Modules\Sales\Contracts\SalesInvoiceLookup;
use App\Modules\Sales\Data\SalesInvoiceData;
use App\Modules\Sales\Enums\InvoiceStatus;
use App\Modules\Sales\Models\SalesInvoice;
use Illuminate\Support\Str;

final class InvoiceDirectory implements SalesInvoiceLookup
{
    public function __construct(private readonly CompanyContext $company) {}

    public function find(string $id): ?SalesInvoiceData
    {
        $invoice = Str::isUuid($id) ? SalesInvoice::query()->find($id) : null;

        return $invoice === null ? null : SalesInvoiceData::of($invoice);
    }

    public function openForParty(string $companyId, string $partyId): array
    {
        return $this->company->runAs($companyId, fn (): array => array_values(SalesInvoice::query()
            ->where('party_id', $partyId)->whereIn('status', InvoiceStatus::open())->where('balance_due', '>', 0)
            ->orderBy('due_date')->orderBy('document_date')->orderBy('id')->get()
            ->map(static fn (SalesInvoice $i): SalesInvoiceData => SalesInvoiceData::of($i))->all()));
    }
}
