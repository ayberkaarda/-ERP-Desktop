<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Services;

use App\Models\User;
use App\Modules\Purchasing\Models\PurchaseDocument;
use App\Modules\Purchasing\Models\PurchaseInvoice;
use App\Modules\Purchasing\Models\PurchaseInvoiceLine;
use App\Modules\Purchasing\Models\PurchaseOrder;
use App\Modules\Purchasing\Models\PurchaseOrderLine;
use App\Modules\Purchasing\Models\PurchaseReceipt;
use App\Modules\Purchasing\Models\PurchaseReceiptLine;
use App\Modules\Purchasing\Models\PurchaseRequest;
use App\Modules\Purchasing\Models\PurchaseReturn;
use App\Modules\Purchasing\Models\PurchaseRfq;
use App\Modules\Purchasing\Policies\PurchasingPolicy;
use Closure;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * The document chain around a document (request -> RFQ -> order -> receipts -> invoices -> returns)
 * for the detail view: each link is {id, document_type, number, status, document_date, total?}.
 */
final class DocumentLinks
{
    /**
     * Links of the document types the viewer may see (purchasing.<type>.view); other types are left
     * out (null or an empty list) without being read.
     *
     * @return array<string, mixed>
     */
    public function for(Model $doc, ?User $viewer = null): array
    {
        $guard = static fn (string $resource, string $shape, Closure $read): mixed => $viewer === null || PurchasingPolicy::permits($viewer, "purchasing.{$resource}.view")
            ? $read() : ($shape === 'many' ? [] : null);

        return match (true) {
            $doc instanceof PurchaseRequest => [
                'rfqs' => $guard('rfqs', 'many', fn () => $this->many(PurchaseRfq::query()->where('request_id', $doc->id))),
                'orders' => $guard('orders', 'many', fn () => $this->many(PurchaseOrder::query()->where('request_id', $doc->id))),
            ],
            $doc instanceof PurchaseRfq => [
                'request' => $guard('requests', 'one', fn () => $this->one(PurchaseRequest::query()->whereKey($doc->request_id))),
                'orders' => $guard('orders', 'many', fn () => $this->many(PurchaseOrder::query()->where('rfq_id', $doc->id))),
            ],
            $doc instanceof PurchaseOrder => [
                'request' => $guard('requests', 'one', fn () => $this->one(PurchaseRequest::query()->whereKey($doc->request_id))),
                'rfq' => $guard('rfqs', 'one', fn () => $this->one(PurchaseRfq::query()->whereKey($doc->rfq_id))),
                'receipts' => $guard('receipts', 'many', fn () => $this->many(PurchaseReceipt::query()->where('order_id', $doc->id))),
                'invoices' => $guard('invoices', 'many', fn () => $this->many(PurchaseInvoice::query()->whereIn('id', PurchaseInvoiceLine::query()->select('document_id')
                    ->whereIn('order_line_id', PurchaseOrderLine::query()->select('id')->where('document_id', $doc->id))))),
            ],
            $doc instanceof PurchaseReceipt => [
                'order' => $guard('orders', 'one', fn () => $this->one(PurchaseOrder::query()->whereKey($doc->order_id))),
                'invoices' => $guard('invoices', 'many', fn () => $this->many(PurchaseInvoice::query()->whereIn('id', PurchaseInvoiceLine::query()->select('document_id')
                    ->whereIn('receipt_line_id', PurchaseReceiptLine::query()->select('id')->where('document_id', $doc->id))))),
                'invoice' => $guard('invoices', 'one', fn () => $this->one(PurchaseInvoice::query()->whereKey($doc->invoice_id))),
                'returns' => $guard('returns', 'many', fn () => $this->many(PurchaseReturn::query()->where('receipt_id', $doc->id))),
            ],
            $doc instanceof PurchaseInvoice => [
                'order' => $guard('orders', 'one', fn () => $this->one(PurchaseOrder::query()->whereKey($doc->order_id))),
                'receipts' => $guard('receipts', 'many', fn () => $this->many(PurchaseReceipt::query()->whereIn('id', PurchaseReceiptLine::query()->select('document_id')
                    ->whereIn('id', PurchaseInvoiceLine::query()->select('receipt_line_id')->where('document_id', $doc->id)->whereNotNull('receipt_line_id'))))),
                'returns' => $guard('returns', 'many', fn () => $this->many(PurchaseReturn::query()->where('invoice_id', $doc->id))),
                'debit_notes' => $guard('invoices', 'many', fn () => $this->many(PurchaseInvoice::query()->where('original_invoice_id', $doc->id))),
                'original_invoice' => $guard('invoices', 'one', fn () => $this->one(PurchaseInvoice::query()->whereKey($doc->original_invoice_id))),
                'return' => $guard('returns', 'one', fn () => $this->one(PurchaseReturn::query()->whereKey($doc->return_id))),
            ],
            $doc instanceof PurchaseReturn => [
                'invoice' => $guard('invoices', 'one', fn () => $this->one(PurchaseInvoice::query()->whereKey($doc->invoice_id))),
                'receipt' => $guard('receipts', 'one', fn () => $this->one(PurchaseReceipt::query()->whereKey($doc->receipt_id))),
                'debit_invoice' => $guard('invoices', 'one', fn () => $this->one(PurchaseInvoice::query()->whereKey($doc->debit_invoice_id))),
            ],
            default => [],
        };
    }

    /**
     * @param  Builder<covariant Model>  $query
     * @return array<string, mixed>|null
     */
    private function one(Builder $query): ?array
    {
        $doc = $query->first();

        return $doc instanceof Model ? self::link($doc) : null;
    }

    /**
     * @param  Builder<covariant Model>  $query
     * @return list<array<string, mixed>>
     */
    private function many(Builder $query): array
    {
        return array_values($query->orderBy('document_date')->orderBy('id')->limit(200)->get()
            ->map(static fn (Model $d): array => self::link($d))->all());
    }

    /** @return array<string, mixed> */
    public static function link(Model $doc): array
    {
        $type = match (true) {
            $doc instanceof PurchaseInvoice && $doc->isDebitNote() => 'purchase_debit_note',
            $doc instanceof PurchaseDocument, $doc instanceof PurchaseRequest, $doc instanceof PurchaseRfq => $doc::kind()->value,
            default => 'unknown',
        };
        $date = $doc->getAttribute('document_date');
        $status = $doc->getAttribute('status');

        return [
            'id' => $doc->getKey(), 'document_type' => $type, 'number' => $doc->getAttribute('number'),
            'status' => $status instanceof \BackedEnum ? $status->value : $status,
            'document_date' => $date instanceof \DateTimeInterface ? $date->format('Y-m-d') : null,
            'total' => $doc instanceof PurchaseDocument ? (string) $doc->total : ($doc instanceof PurchaseRequest ? (string) $doc->estimated_total : null),
            'currency_code' => $doc->getAttribute('currency_code'),
        ];
    }
}
