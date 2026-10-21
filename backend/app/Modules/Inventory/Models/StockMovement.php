<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Money\DecimalCast;
use App\Core\Money\MoneyCast;
use App\Core\Support\HasUuid7;
use App\Modules\Inventory\Enums\Direction;
use App\Modules\Inventory\Enums\MovementType;
use Brick\Math\BigDecimal;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Read model of the append-only ledger; rows are inserted in bulk by the stock ledger only.
 *
 * @property string $id
 * @property string $company_id
 * @property int $seq
 * @property string $item_id
 * @property string $warehouse_id
 * @property string|null $location_id
 * @property string|null $lot_id
 * @property string|null $serial_id
 * @property MovementType $movement_type
 * @property Direction $direction
 * @property BigDecimal $quantity
 * @property BigDecimal $unit_cost
 * @property BigDecimal $total_cost
 * @property Carbon $occurred_at
 * @property string $document_type
 * @property string $document_id
 * @property string|null $document_line_id
 * @property string|null $journal_entry_id
 * @property string|null $reverses_id
 * @property string|null $cost_layer_id
 * @property string|null $created_by
 * @property Carbon|null $created_at
 */
class StockMovement extends Model
{
    use BelongsToCompany;
    use HasUuid7;

    public $timestamps = false;

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'seq' => 'integer',
            'movement_type' => MovementType::class,
            'direction' => Direction::class,
            'quantity' => DecimalCast::class,
            'unit_cost' => DecimalCast::class,
            'total_cost' => MoneyCast::class,
            'occurred_at' => 'date',
            'created_at' => 'datetime',
        ];
    }
}
