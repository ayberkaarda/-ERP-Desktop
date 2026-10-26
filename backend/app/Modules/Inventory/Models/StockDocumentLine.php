<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Money\DecimalCast;
use App\Core\Support\HasUuid7;
use Brick\Math\BigDecimal;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Written in bulk with its document and audited through it, so no activity log here.
 *
 * @property string $id
 * @property string $company_id
 * @property string $document_id
 * @property int $line_no
 * @property string $item_id
 * @property string $unit_id
 * @property BigDecimal $quantity
 * @property BigDecimal $base_quantity
 * @property BigDecimal|null $unit_cost
 * @property string|null $lot_no
 * @property Carbon|null $expiry_date
 * @property list<string> $serial_numbers
 * @property string|null $location_id
 * @property string|null $target_location_id
 * @property string|null $direction
 * @property BigDecimal|null $system_quantity
 * @property BigDecimal|null $counted_quantity
 * @property string|null $notes
 * @property string|null $reservation_id
 */
class StockDocumentLine extends Model
{
    use BelongsToCompany;
    use HasUuid7;

    public const array COLUMNS = [
        'line_no', 'item_id', 'unit_id', 'quantity', 'base_quantity', 'unit_cost', 'lot_no', 'expiry_date', 'serial_numbers',
        'location_id', 'target_location_id', 'direction', 'system_quantity', 'counted_quantity', 'notes', 'reservation_id',
    ];

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = self::COLUMNS;

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'line_no' => 'integer',
            'quantity' => DecimalCast::class,
            'base_quantity' => DecimalCast::class,
            'unit_cost' => DecimalCast::class,
            'system_quantity' => DecimalCast::class,
            'counted_quantity' => DecimalCast::class,
            'expiry_date' => 'date',
            'serial_numbers' => 'array',
        ];
    }
}
