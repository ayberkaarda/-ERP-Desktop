<?php

declare(strict_types=1);

namespace App\Modules\Sales\Models;

use App\Core\Money\DecimalCast;
use App\Modules\Sales\Enums\DeliveryStatus;
use App\Modules\Sales\Enums\DocumentKind;
use Brick\Math\BigDecimal;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * Dispatch note. Posting issues the stock through the Inventory StockService (which books the COGS).
 *
 * @property DeliveryStatus $status
 * @property string|null $order_id
 * @property string|null $invoice_id
 * @property string|null $stock_document_id
 * @property string|null $journal_entry_id
 * @property BigDecimal $cost_total
 * @property Carbon|null $posted_at
 * @property string|null $posted_by
 * @property Carbon|null $cancelled_at
 * @property string|null $cancelled_by
 * @property string|null $cancel_reason
 * @property string|null $reversal_stock_document_id
 * @property-read Collection<int, SalesDeliveryLine> $lines
 */
class SalesDelivery extends SalesDocument
{
    protected $table = 'sales_deliveries';

    /** @var array<string, mixed> */
    protected $attributes = ['status' => 'draft'];

    public static function kind(): DocumentKind
    {
        return DocumentKind::Delivery;
    }

    public static function lineClass(): string
    {
        return SalesDeliveryLine::class;
    }

    /** @return HasMany<SalesDeliveryLine, $this> */
    public function lines(): HasMany
    {
        return $this->hasMany(SalesDeliveryLine::class, 'document_id')->orderBy('line_no');
    }

    protected function extraCasts(): array
    {
        return ['status' => DeliveryStatus::class, 'cost_total' => DecimalCast::class.':4', 'posted_at' => 'datetime', 'cancelled_at' => 'datetime'];
    }
}
