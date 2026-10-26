<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Models;

use App\Core\Money\DecimalCast;
use Brick\Math\BigDecimal;

/**
 * unit_cost/cost_total: what the return_out movements took out of stock (company currency);
 * receipt_cost: the same quantity at its goods receipt cost, the amount cleared through the goods
 * received not invoiced account by the return and its debit note.
 *
 * @property string|null $invoice_line_id
 * @property string|null $receipt_line_id
 * @property string|null $lot_no
 * @property list<string> $serial_numbers
 * @property BigDecimal|null $unit_cost
 * @property BigDecimal|null $cost_total
 * @property BigDecimal|null $receipt_cost
 */
class PurchaseReturnLine extends PurchaseLine
{
    protected $table = 'purchase_return_lines';

    /** @var array<string, mixed> */
    protected $attributes = ['serial_numbers' => '[]'];

    protected function extraCasts(): array
    {
        return [
            'serial_numbers' => 'array', 'unit_cost' => DecimalCast::class, 'cost_total' => DecimalCast::class.':4',
            'receipt_cost' => DecimalCast::class.':4',
        ];
    }
}
