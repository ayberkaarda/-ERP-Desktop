<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Models;

use App\Core\Money\DecimalCast;
use App\Modules\Purchasing\Enums\DocumentKind;
use App\Modules\Purchasing\Enums\ReceiptStatus;
use Brick\Math\BigDecimal;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * Goods receipt (GRN). Posted receipts are immutable (trigger KP003) except their cancellation.
 *
 * @property ReceiptStatus $status
 * @property string|null $order_id
 * @property string|null $invoice_id
 * @property string|null $supplier_reference
 * @property string|null $stock_document_id
 * @property string|null $journal_entry_id
 * @property BigDecimal $cost_total
 * @property Carbon|null $posted_at
 * @property string|null $posted_by
 * @property Carbon|null $cancelled_at
 * @property string|null $cancelled_by
 * @property string|null $cancel_reason
 * @property string|null $reversal_stock_document_id
 * @property Carbon|null $reversal_date
 * @property-read Collection<int, PurchaseReceiptLine> $lines
 */
class PurchaseReceipt extends PurchaseDocument
{
    protected $table = 'purchase_receipts';

    /** @var array<string, mixed> */
    protected $attributes = ['status' => 'draft'];

    public static function kind(): DocumentKind
    {
        return DocumentKind::Receipt;
    }

    public static function lineClass(): string
    {
        return PurchaseReceiptLine::class;
    }

    /** @return HasMany<PurchaseReceiptLine, $this> */
    public function lines(): HasMany
    {
        return $this->hasMany(PurchaseReceiptLine::class, 'document_id')->orderBy('line_no');
    }

    protected function extraCasts(): array
    {
        return [
            'status' => ReceiptStatus::class, 'cost_total' => DecimalCast::class.':4', 'posted_at' => 'datetime',
            'cancelled_at' => 'datetime', 'reversal_date' => 'date',
        ];
    }
}
