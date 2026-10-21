<?php

declare(strict_types=1);

namespace App\Modules\Sales\Data;

use App\Modules\Sales\Models\SalesInvoice;

/**
 * An invoice or credit note as other modules (treasury, e-documents, projects) see it.
 * Amounts are in the document currency (scale 4); *Local in the company currency.
 */
final readonly class SalesInvoiceData
{
    public function __construct(
        public string $id,
        public string $companyId,
        public ?string $number,
        public string $invoiceType,
        public string $status,
        public string $partyId,
        public string $partyName,
        public ?string $partyTaxNumber,
        public string $documentDate,
        public ?string $dueDate,
        public string $currencyCode,
        public string $fxRate,
        public string $total,
        public string $totalLocal,
        public string $paidAmount,
        public string $balanceDue,
        public ?string $journalEntryId,
    ) {}

    public static function of(SalesInvoice $invoice): self
    {
        return new self(
            $invoice->id,
            $invoice->company_id,
            $invoice->number,
            $invoice->invoice_type->value,
            $invoice->status->value,
            $invoice->party_id,
            $invoice->party_name,
            $invoice->party_tax_number,
            $invoice->document_date->format('Y-m-d'),
            $invoice->due_date?->format('Y-m-d'),
            $invoice->currency_code,
            (string) $invoice->fx_rate,
            (string) $invoice->total,
            (string) $invoice->total_local,
            (string) $invoice->paid_amount,
            (string) $invoice->balance_due,
            $invoice->journal_entry_id,
        );
    }
}
