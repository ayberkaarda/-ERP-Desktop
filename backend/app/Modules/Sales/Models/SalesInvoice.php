<?php

declare(strict_types=1);

namespace App\Modules\Sales\Models;

use App\Core\Money\DecimalCast;
use App\Modules\Sales\Enums\DocumentKind;
use App\Modules\Sales\Enums\InvoiceStatus;
use App\Modules\Sales\Enums\InvoiceType;
use Brick\Math\BigDecimal;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * Sales invoice or credit note (invoice_type return). Issued invoices are immutable (trigger KS001).
 *
 * @property InvoiceStatus $status
 * @property InvoiceType $invoice_type
 * @property string|null $order_id
 * @property string|null $delivery_id
 * @property string|null $return_id
 * @property string|null $original_invoice_id
 * @property bool $deliver_on_invoice
 * @property string|null $journal_entry_id
 * @property string|null $reversal_journal_entry_id
 * @property BigDecimal $paid_amount
 * @property BigDecimal $balance_due
 * @property Carbon|null $issued_at
 * @property string|null $issued_by
 * @property Carbon|null $reversed_at
 * @property string|null $reversed_by
 * @property Carbon|null $reversal_date
 * @property string|null $reversal_reason
 * @property string|null $credit_override_reason
 * @property string|null $credit_override_by
 * @property string|null $e_document_status
 * @property string|null $e_document_uuid
 * @property-read Collection<int, SalesInvoiceLine> $lines
 */
class SalesInvoice extends SalesDocument
{
    protected $table = 'sales_invoices';

    /** @var array<string, mixed> */
    protected $attributes = ['status' => 'draft', 'invoice_type' => 'sale', 'deliver_on_invoice' => false];

    public static function kind(): DocumentKind
    {
        return DocumentKind::Invoice;
    }

    public static function lineClass(): string
    {
        return SalesInvoiceLine::class;
    }

    /** @return HasMany<SalesInvoiceLine, $this> */
    public function lines(): HasMany
    {
        return $this->hasMany(SalesInvoiceLine::class, 'document_id')->orderBy('line_no');
    }

    public function numberKind(): DocumentKind
    {
        return $this->isCreditNote() ? DocumentKind::CreditNote : DocumentKind::Invoice;
    }

    public function isCreditNote(): bool
    {
        return $this->invoice_type === InvoiceType::Return;
    }

    protected function extraCasts(): array
    {
        return [
            'status' => InvoiceStatus::class, 'invoice_type' => InvoiceType::class, 'deliver_on_invoice' => 'boolean',
            'paid_amount' => DecimalCast::class.':4', 'balance_due' => DecimalCast::class.':4',
            'issued_at' => 'datetime', 'reversed_at' => 'datetime', 'reversal_date' => 'date',
        ];
    }
}
