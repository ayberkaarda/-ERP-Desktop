<?php

declare(strict_types=1);

namespace App\Modules\Sales\Models;

use App\Modules\Sales\Enums\DocumentKind;
use App\Modules\Sales\Enums\ReturnStatus;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * Customer return against an issued invoice: receiving posts return_in stock at the original cost
 * (which also reverses the COGS); crediting issues the credit note.
 *
 * @property ReturnStatus $status
 * @property string $invoice_id
 * @property string|null $reason
 * @property string|null $stock_document_id
 * @property string|null $journal_entry_id
 * @property string|null $credit_invoice_id
 * @property Carbon|null $approved_at
 * @property string|null $approved_by
 * @property Carbon|null $received_at
 * @property string|null $received_by
 * @property Carbon|null $credited_at
 * @property string|null $credited_by
 * @property Carbon|null $cancelled_at
 * @property-read Collection<int, SalesReturnLine> $lines
 */
class SalesReturn extends SalesDocument
{
    protected $table = 'sales_returns';

    /** @var array<string, mixed> */
    protected $attributes = ['status' => 'draft'];

    public static function kind(): DocumentKind
    {
        return DocumentKind::SalesReturn;
    }

    public static function lineClass(): string
    {
        return SalesReturnLine::class;
    }

    /** @return HasMany<SalesReturnLine, $this> */
    public function lines(): HasMany
    {
        return $this->hasMany(SalesReturnLine::class, 'document_id')->orderBy('line_no');
    }

    protected function extraCasts(): array
    {
        return [
            'status' => ReturnStatus::class, 'approved_at' => 'datetime', 'received_at' => 'datetime',
            'credited_at' => 'datetime', 'cancelled_at' => 'datetime',
        ];
    }
}
