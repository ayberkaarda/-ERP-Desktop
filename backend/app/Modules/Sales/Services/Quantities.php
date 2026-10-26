<?php

declare(strict_types=1);

namespace App\Modules\Sales\Services;

use App\Modules\Sales\Enums\InvoiceStatus;
use App\Modules\Sales\Support\Sales;
use Brick\Math\BigDecimal;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Quantities that later documents hold on their source lines (drafts included, cancelled and
 * reversed excluded). Callers hold the row lock of the source header, so these sums cannot change
 * underneath them.
 */
final class Quantities
{
    /** Quantity of draft and posted deliveries on an order line. */
    public function deliveredOrHeld(string $orderLineId, ?string $exceptDeliveryId = null): BigDecimal
    {
        return $this->sum(DB::table('sales_delivery_lines as l')->join('sales_deliveries as d', 'd.id', '=', 'l.document_id')
            ->where('l.order_line_id', $orderLineId)->whereIn('d.status', ['draft', 'posted'])
            ->when($exceptDeliveryId !== null, fn ($q) => $q->where('d.id', '<>', $exceptDeliveryId)));
    }

    /** Quantity of invoices (draft to paid) on a delivery line. */
    public function invoicedOnDelivery(string $deliveryLineId, ?string $exceptInvoiceId = null): BigDecimal
    {
        return $this->sum($this->invoiceLines($exceptInvoiceId)->where('l.delivery_line_id', $deliveryLineId));
    }

    /** Quantity of invoices (draft to paid) on an order line, through deliveries or directly. */
    public function invoicedOnOrder(string $orderLineId, ?string $exceptInvoiceId = null): BigDecimal
    {
        return $this->sum($this->invoiceLines($exceptInvoiceId)->where('l.order_line_id', $orderLineId));
    }

    /** Quantity of returns that are not cancelled on an invoice line. */
    public function returned(string $invoiceLineId, ?string $exceptReturnId = null): BigDecimal
    {
        return $this->sum(DB::table('sales_return_lines as l')->join('sales_returns as r', 'r.id', '=', 'l.document_id')
            ->where('l.invoice_line_id', $invoiceLineId)->where('r.status', '<>', 'cancelled')
            ->when($exceptReturnId !== null, fn ($q) => $q->where('r.id', '<>', $exceptReturnId)));
    }

    private function invoiceLines(?string $exceptInvoiceId): Builder
    {
        return DB::table('sales_invoice_lines as l')->join('sales_invoices as i', 'i.id', '=', 'l.document_id')
            ->where('i.invoice_type', 'sale')->whereIn('i.status', InvoiceStatus::holding())
            ->when($exceptInvoiceId !== null, fn ($q) => $q->where('i.id', '<>', $exceptInvoiceId));
    }

    private function sum(Builder $query): BigDecimal
    {
        $value = $query->selectRaw('coalesce(sum(l.quantity), 0) AS s')->value('s');

        return Sales::dec(is_numeric($value) ? (string) $value : '0');
    }
}
