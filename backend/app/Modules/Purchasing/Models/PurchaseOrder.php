<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Models;

use App\Modules\Purchasing\Enums\DocumentKind;
use App\Modules\Purchasing\Enums\OrderStatus;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * @property OrderStatus $status
 * @property Carbon|null $expected_date
 * @property string|null $supplier_reference
 * @property string|null $request_id
 * @property string|null $rfq_id
 * @property int $revision
 * @property string|null $approval_request_id
 * @property string|null $approval_comment
 * @property Carbon|null $approved_at
 * @property string|null $approved_by
 * @property Carbon|null $sent_at
 * @property Carbon|null $cancelled_at
 * @property Carbon|null $closed_at
 * @property-read Collection<int, PurchaseOrderLine> $lines
 */
class PurchaseOrder extends PurchaseDocument
{
    protected $table = 'purchase_orders';

    /** @var array<string, mixed> */
    protected $attributes = ['status' => 'draft', 'revision' => 1];

    public static function kind(): DocumentKind
    {
        return DocumentKind::Order;
    }

    public static function lineClass(): string
    {
        return PurchaseOrderLine::class;
    }

    /** @return HasMany<PurchaseOrderLine, $this> */
    public function lines(): HasMany
    {
        return $this->hasMany(PurchaseOrderLine::class, 'document_id')->orderBy('line_no');
    }

    protected function extraCasts(): array
    {
        return [
            'status' => OrderStatus::class, 'expected_date' => 'date', 'revision' => 'integer',
            'approved_at' => 'datetime', 'sent_at' => 'datetime', 'cancelled_at' => 'datetime', 'closed_at' => 'datetime',
        ];
    }
}
