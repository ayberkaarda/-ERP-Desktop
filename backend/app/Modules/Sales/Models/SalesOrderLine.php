<?php

declare(strict_types=1);

namespace App\Modules\Sales\Models;

use App\Core\Money\DecimalCast;
use Brick\Math\BigDecimal;

/**
 * Delivered and invoiced quantities (line unit) are maintained by the services under the order lock.
 *
 * @property BigDecimal $delivered_quantity
 * @property BigDecimal $invoiced_quantity
 * @property string|null $reservation_id
 */
class SalesOrderLine extends SalesLine
{
    protected $table = 'sales_order_lines';

    protected function extraCasts(): array
    {
        return ['delivered_quantity' => DecimalCast::class, 'invoiced_quantity' => DecimalCast::class];
    }
}
