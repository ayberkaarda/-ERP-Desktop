<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Models;

use App\Core\Money\DecimalCast;
use App\Modules\Purchasing\Enums\DocumentKind;
use App\Modules\Purchasing\Enums\InvoiceStatus;
use App\Modules\Purchasing\Enums\InvoiceType;
use Brick\Math\BigDecimal;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * Supplier invoice or debit note (invoice_type return). Booked invoices are immutable (trigger
 * KP001). balance_due = total - withholding_total - paid_amount while booked.
 *
 * @property InvoiceStatus $status
 * @property InvoiceType $invoice_type
 * @property string|null $supplier_invoice_no
 * @property string|null $order_id
 * @property string|null $receipt_id
 * @property string|null $return_id
 * @property string|null $original_invoice_id
 * @property bool $receive_on_invoice
 * @property string|null $journal_entry_id
 * @property string|null $reversal_journal_entry_id
 * @property BigDecimal $paid_amount
 * @property BigDecimal $balance_due
 * @property string|null $match_status
 * @property string|null $match_override_reason
 * @property string|null $match_override_by
 * @property string|null $approval_request_id
 * @property string|null $approval_comment
 * @property Carbon|null $approved_at
 * @property string|null $approved_by
 * @property Carbon|null $booked_at
 * @property string|null $booked_by
 * @property Carbon|null $reversed_at
 * @property string|null $reversed_by
 * @property Carbon|null $reversal_date
 * @property string|null $reversal_reason
 * @property string|null $e_document_status
 * @property string|null $e_document_uuid
 * @property-read Collection<int, PurchaseInvoiceLine> $lines
 */
class PurchaseInvoice extends PurchaseDocument
{
    protected $table = 'purchase_invoices';

    /** @var array<string, mixed> */
    protected $attributes = ['status' => 'draft', 'invoice_type' => 'purchase', 'receive_on_invoice' => false];

    public static function kind(): DocumentKind
    {
        return DocumentKind::Invoice;
    }

    public static function lineClass(): string
    {
        return PurchaseInvoiceLine::class;
    }

    /** @return HasMany<PurchaseInvoiceLine, $this> */
    public function lines(): HasMany
    {
        return $this->hasMany(PurchaseInvoiceLine::class, 'document_id')->orderBy('line_no');
    }

    public function numberKind(): DocumentKind
    {
        return $this->isDebitNote() ? DocumentKind::DebitNote : DocumentKind::Invoice;
    }

    public function isDebitNote(): bool
    {
        return $this->invoice_type === InvoiceType::Return;
    }

    /** What the supplier is owed when booked: total less the withheld VAT (document currency). */
    public function payable(): BigDecimal
    {
        return $this->total->minus($this->withholding_total);
    }

    protected function extraCasts(): array
    {
        return [
            'status' => InvoiceStatus::class, 'invoice_type' => InvoiceType::class, 'receive_on_invoice' => 'boolean',
            'paid_amount' => DecimalCast::class.':4', 'balance_due' => DecimalCast::class.':4', 'approved_at' => 'datetime',
            'booked_at' => 'datetime', 'reversed_at' => 'datetime', 'reversal_date' => 'date',
        ];
    }
}
