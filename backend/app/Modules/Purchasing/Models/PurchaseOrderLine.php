<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Models;

use App\Core\Money\DecimalCast;
use Brick\Math\BigDecimal;
use Illuminate\Support\Carbon;

/**
 * Received and invoiced quantities (line unit) are maintained by the services under the order lock.
 *
 * @property BigDecimal $received_quantity
 * @property BigDecimal $invoiced_quantity
 * @property string|null $request_line_id
 * @property string|null $rfq_line_id
 * @property Carbon|null $expected_date
 */
class PurchaseOrderLine extends PurchaseLine
{
    protected $table = 'purchase_order_lines';

    protected function extraCasts(): array
    {
        return ['received_quantity' => DecimalCast::class, 'invoiced_quantity' => DecimalCast::class, 'expected_date' => 'date'];
    }
}
