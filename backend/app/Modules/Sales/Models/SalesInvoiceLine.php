<?php

declare(strict_types=1);

namespace App\Modules\Sales\Models;

/**
 * @property string|null $order_line_id
 * @property string|null $delivery_line_id
 * @property string|null $original_line_id
 */
class SalesInvoiceLine extends SalesLine
{
    protected $table = 'sales_invoice_lines';
}
