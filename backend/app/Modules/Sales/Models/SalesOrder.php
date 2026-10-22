<?php

declare(strict_types=1);

namespace App\Modules\Sales\Models;

use App\Core\Money\MoneyCast;
use App\Modules\Sales\Enums\DocumentKind;
use App\Modules\Sales\Enums\OrderStatus;
use Brick\Math\BigDecimal;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * @property OrderStatus $status
 * @property Carbon|null $requested_delivery_date
 * @property string|null $quote_id
 * @property int $revision
 * @property string|null $credit_override_reason
 * @property string|null $credit_override_by
 * @property string|null $credit_override_party_id
 * @property int|null $credit_override_revision
 * @property BigDecimal|null $credit_override_amount
 * @property BigDecimal|null $credit_override_exposure
 * @property string|null $credit_override_currency
 * @property string|null $approval_request_id
 * @property string|null $approval_comment
 * @property Carbon|null $confirmed_at
 * @property string|null $confirmed_by
 * @property Carbon|null $cancelled_at
 * @property Carbon|null $closed_at
 * @property-read Collection<int, SalesOrderLine> $lines
 */
class SalesOrder extends SalesDocument
{
    protected $table = 'sales_orders';

    /** @var array<string, mixed> */
    protected $attributes = ['status' => 'draft', 'revision' => 1];

    public static function kind(): DocumentKind
    {
        return DocumentKind::Order;
    }

    public static function lineClass(): string
    {
        return SalesOrderLine::class;
    }

    /** @return HasMany<SalesOrderLine, $this> */
    public function lines(): HasMany
    {
        return $this->hasMany(SalesOrderLine::class, 'document_id')->orderBy('line_no');
    }

    protected function extraCasts(): array
    {
        return [
            'status' => OrderStatus::class, 'requested_delivery_date' => 'date', 'revision' => 'integer', 'credit_override_revision' => 'integer',
            'credit_override_amount' => MoneyCast::class, 'credit_override_exposure' => MoneyCast::class,
            'confirmed_at' => 'datetime', 'cancelled_at' => 'datetime', 'closed_at' => 'datetime',
        ];
    }
}
