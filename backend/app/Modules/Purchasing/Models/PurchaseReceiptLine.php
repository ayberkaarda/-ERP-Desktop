<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Models;

use App\Core\Money\DecimalCast;
use Brick\Math\BigDecimal;
use Illuminate\Support\Carbon;

/**
 * unit_cost (per base unit) and cost_total are in company currency, as booked by the stock posting.
 *
 * @property string|null $order_line_id
 * @property string|null $lot_no
 * @property Carbon|null $expiry_date
 * @property list<string> $serial_numbers
 * @property string|null $location_id
 * @property BigDecimal|null $unit_cost
 * @property BigDecimal|null $cost_total
 */
class PurchaseReceiptLine extends PurchaseLine
{
    protected $table = 'purchase_receipt_lines';

    /** @var array<string, mixed> */
    protected $attributes = ['serial_numbers' => '[]'];

    protected function extraCasts(): array
    {
        return [
            'expiry_date' => 'date', 'serial_numbers' => 'array', 'unit_cost' => DecimalCast::class, 'cost_total' => DecimalCast::class.':4',
        ];
    }
}
