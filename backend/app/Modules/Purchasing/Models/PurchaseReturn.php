<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Models;

use App\Modules\Purchasing\Enums\DocumentKind;
use App\Modules\Purchasing\Enums\ReturnStatus;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * Return to the supplier, from a booked invoice (debited by a debit note) or from the not yet
 * invoiced part of a posted receipt (complete once shipped).
 *
 * @property ReturnStatus $status
 * @property string|null $invoice_id
 * @property string|null $receipt_id
 * @property string|null $reason
 * @property string|null $stock_document_id
 * @property string|null $journal_entry_id
 * @property string|null $debit_invoice_id
 * @property Carbon|null $approved_at
 * @property string|null $approved_by
 * @property Carbon|null $shipped_at
 * @property string|null $shipped_by
 * @property Carbon|null $debited_at
 * @property string|null $debited_by
 * @property Carbon|null $cancelled_at
 * @property-read Collection<int, PurchaseReturnLine> $lines
 */
class PurchaseReturn extends PurchaseDocument
{
    protected $table = 'purchase_returns';

    /** @var array<string, mixed> */
    protected $attributes = ['status' => 'draft'];

    public static function kind(): DocumentKind
    {
        return DocumentKind::PurchaseReturn;
    }

    public static function lineClass(): string
    {
        return PurchaseReturnLine::class;
    }

    /** @return HasMany<PurchaseReturnLine, $this> */
    public function lines(): HasMany
    {
        return $this->hasMany(PurchaseReturnLine::class, 'document_id')->orderBy('line_no');
    }

    protected function extraCasts(): array
    {
        return [
            'status' => ReturnStatus::class, 'approved_at' => 'datetime', 'shipped_at' => 'datetime', 'debited_at' => 'datetime',
            'cancelled_at' => 'datetime',
        ];
    }
}
