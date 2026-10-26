<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Models;

use App\Core\Money\DecimalCast;
use Brick\Math\BigDecimal;

/**
 * Booking amounts in company currency, written when the invoice is booked: net_local (this line's
 * share of the net), grni_amount (goods received not invoiced cleared), variance_amount
 * (net_local - grni_amount on received lines) and expense_amount (lines without a receipt).
 *
 * @property string|null $order_line_id
 * @property string|null $receipt_line_id
 * @property string|null $original_line_id
 * @property string|null $match_status
 * @property array<string, mixed>|null $match_details
 * @property BigDecimal $net_local
 * @property BigDecimal $grni_amount
 * @property BigDecimal $variance_amount
 * @property BigDecimal $expense_amount
 */
class PurchaseInvoiceLine extends PurchaseLine
{
    protected $table = 'purchase_invoice_lines';

    protected function extraCasts(): array
    {
        return [
            'match_details' => 'array', 'net_local' => DecimalCast::class.':4', 'grni_amount' => DecimalCast::class.':4',
            'variance_amount' => DecimalCast::class.':4', 'expense_amount' => DecimalCast::class.':4',
        ];
    }
}
