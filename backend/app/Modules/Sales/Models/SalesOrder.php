<?php

declare(strict_types=1);

namespace App\Modules\Sales\Models;

use App\Modules\Sales\Enums\DocumentKind;
use App\Modules\Sales\Enums\OrderStatus;
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
            'status' => OrderStatus::class, 'requested_delivery_date' => 'date', 'revision' => 'integer',
            'confirmed_at' => 'datetime', 'cancelled_at' => 'datetime', 'closed_at' => 'datetime',
        ];
    }
}
