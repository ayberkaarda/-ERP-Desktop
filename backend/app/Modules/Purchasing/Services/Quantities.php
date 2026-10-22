<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Services;

use App\Modules\Purchasing\Enums\InvoiceStatus;
use App\Modules\Purchasing\Support\Purchasing;
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
    /** Quantity of draft and posted receipts on an order line. */
    public function receivedOrHeld(string $orderLineId, ?string $exceptReceiptId = null): BigDecimal
    {
        return $this->sum(DB::table('purchase_receipt_lines as l')->join('purchase_receipts as r', 'r.id', '=', 'l.document_id')
            ->where('l.order_line_id', $orderLineId)->whereIn('r.status', ['draft', 'posted'])
            ->when($exceptReceiptId !== null, fn ($q) => $q->where('r.id', '<>', $exceptReceiptId)));
    }

    /** Quantity of invoices (draft to paid) on a receipt line. */
    public function invoicedOnReceipt(string $receiptLineId, ?string $exceptInvoiceId = null): BigDecimal
    {
        return $this->sum($this->invoiceLines($exceptInvoiceId)->where('l.receipt_line_id', $receiptLineId));
    }

    /** Quantity of invoices (draft to paid) on an order line, through receipts or directly. */
    public function invoicedOnOrder(string $orderLineId, ?string $exceptInvoiceId = null): BigDecimal
    {
        return $this->sum($this->invoiceLines($exceptInvoiceId)->where('l.order_line_id', $orderLineId));
    }

    /** Quantity of returns (not cancelled) on an invoice line. */
    public function returnedOnInvoice(string $invoiceLineId, ?string $exceptReturnId = null): BigDecimal
    {
        return $this->sum($this->returnLines($exceptReturnId)->where('l.invoice_line_id', $invoiceLineId));
    }

    /** Quantity of returns (not cancelled) made from a receipt line before it was invoiced. */
    public function returnedOnReceipt(string $receiptLineId, ?string $exceptReturnId = null): BigDecimal
    {
        return $this->sum($this->returnLines($exceptReturnId)->where('l.receipt_line_id', $receiptLineId)->whereNull('l.invoice_line_id'));
    }

    /** Quantity of orders (not cancelled, drafts included) created from a request line. */
    public function orderedOnRequest(string $requestLineId, ?string $exceptOrderId = null): BigDecimal
    {
        return $this->sum(DB::table('purchase_order_lines as l')->join('purchase_orders as o', 'o.id', '=', 'l.document_id')
            ->where('l.request_line_id', $requestLineId)->where('o.status', '<>', 'cancelled')
            ->when($exceptOrderId !== null, fn ($q) => $q->where('o.id', '<>', $exceptOrderId)));
    }

    /**
     * What a receipt line can still be invoiced or returned for: received minus invoiced minus
     * returned before invoicing.
     */
    public function openOnReceipt(string $receiptLineId, BigDecimal $received, ?string $exceptInvoiceId = null, ?string $exceptReturnId = null): BigDecimal
    {
        return $received->minus($this->invoicedOnReceipt($receiptLineId, $exceptInvoiceId))->minus($this->returnedOnReceipt($receiptLineId, $exceptReturnId));
    }

    private function invoiceLines(?string $exceptInvoiceId): Builder
    {
        return DB::table('purchase_invoice_lines as l')->join('purchase_invoices as i', 'i.id', '=', 'l.document_id')
            ->where('i.invoice_type', 'purchase')->whereIn('i.status', InvoiceStatus::holding())
            ->when($exceptInvoiceId !== null, fn ($q) => $q->where('i.id', '<>', $exceptInvoiceId));
    }

    private function returnLines(?string $exceptReturnId): Builder
    {
        return DB::table('purchase_return_lines as l')->join('purchase_returns as r', 'r.id', '=', 'l.document_id')
            ->where('r.status', '<>', 'cancelled')
            ->when($exceptReturnId !== null, fn ($q) => $q->where('r.id', '<>', $exceptReturnId));
    }

    private function sum(Builder $query): BigDecimal
    {
        $value = $query->selectRaw('coalesce(sum(l.quantity), 0) AS s')->value('s');

        return Purchasing::dec(is_numeric($value) ? (string) $value : '0');
    }
}
