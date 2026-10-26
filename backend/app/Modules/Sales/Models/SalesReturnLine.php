<?php

declare(strict_types=1);

namespace App\Modules\Sales\Models;

use App\Core\Money\DecimalCast;
use Brick\Math\BigDecimal;

/**
 * @property string $invoice_line_id
 * @property string|null $delivery_line_id
 * @property string|null $lot_no
 * @property list<string> $serial_numbers
 * @property BigDecimal|null $unit_cost
 * @property BigDecimal|null $cost_total
 */
class SalesReturnLine extends SalesLine
{
    protected $table = 'sales_return_lines';

    /** @var array<string, mixed> */
    protected $attributes = ['serial_numbers' => '[]'];

    protected function extraCasts(): array
    {
        return ['serial_numbers' => 'array', 'unit_cost' => DecimalCast::class, 'cost_total' => DecimalCast::class.':4'];
    }
}
