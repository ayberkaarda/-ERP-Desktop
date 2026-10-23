<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Data;

use App\Modules\Purchasing\Models\PurchaseInvoice;

/**
 * A supplier invoice or debit note as other modules (treasury, e-documents, reporting) see it.
 * Amounts are in the document currency (scale 4); *Local in the company currency. payable is the
 * total less the withheld VAT.
 */
final readonly class PurchaseInvoiceData
{
    public function __construct(
        public string $id,
        public string $companyId,
        public ?string $number,
        public string $invoiceType,
        public string $status,
        public ?string $supplierInvoiceNo,
        public string $partyId,
        public string $partyName,
        public ?string $partyTaxNumber,
        public string $documentDate,
        public ?string $dueDate,
        public string $currencyCode,
        public string $fxRate,
        public string $total,
        public string $totalLocal,
        public string $withholdingTotal,
        public string $payable,
        public string $paidAmount,
        public string $balanceDue,
        public ?string $journalEntryId,
        public ?string $payableLocal = null,
        public ?string $balanceLocal = null,
    ) {}

    public static function of(PurchaseInvoice $invoice): self
    {
        return new self(
            $invoice->id,
            $invoice->company_id,
            $invoice->number,
            $invoice->invoice_type->value,
            $invoice->status->value,
            $invoice->supplier_invoice_no,
            $invoice->party_id,
            $invoice->party_name,
            $invoice->party_tax_number,
            $invoice->document_date->format('Y-m-d'),
            $invoice->due_date?->format('Y-m-d'),
            $invoice->currency_code,
            (string) $invoice->fx_rate,
            (string) $invoice->total,
            (string) $invoice->total_local,
            (string) $invoice->withholding_total,
            (string) $invoice->payable()->toScale(4),
            (string) $invoice->paid_amount,
            (string) $invoice->balance_due,
            $invoice->journal_entry_id,
            (string) $invoice->total_local->minus($invoice->withholding_total_local),
            is_string($invoice->getAttribute('treasury_balance_local')) ? $invoice->getAttribute('treasury_balance_local') : null,
        );
    }
}
