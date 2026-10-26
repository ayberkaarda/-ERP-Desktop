<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Models;

use App\Core\Documents\HasVersion;
use App\Core\Money\DecimalCast;
use App\Modules\Inventory\Enums\ReservationStatus;
use Brick\Math\BigDecimal;
use Illuminate\Support\Carbon;

/**
 * @property string $item_id
 * @property string $warehouse_id
 * @property string|null $lot_id
 * @property BigDecimal $quantity
 * @property ReservationStatus $status
 * @property string|null $source_type
 * @property string|null $source_id
 * @property Carbon|null $expires_at
 * @property Carbon|null $closed_at
 * @property string|null $notes
 * @property string|null $created_by
 * @property int $version
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
class StockReservation extends InventoryModel
{
    use HasVersion;

    public const array FIELDS = ['quantity', 'status', 'expires_at', 'closed_at'];

    /** @var list<string> */
    protected $fillable = ['item_id', 'warehouse_id', 'lot_id', 'quantity', 'source_type', 'source_id', 'expires_at', 'notes'];

    /** @var array<string, mixed> */
    protected $attributes = ['status' => 'active'];

    public function getMorphClass(): string
    {
        return 'stock_reservation';
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'quantity' => DecimalCast::class,
            'status' => ReservationStatus::class,
            'expires_at' => 'datetime',
            'closed_at' => 'datetime',
        ];
    }
}
