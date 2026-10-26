<?php

declare(strict_types=1);

namespace App\Modules\Sales\Services;

use App\Modules\Sales\Models\SalesDelivery;
use App\Modules\Sales\Models\SalesDeliveryLine;
use App\Modules\Sales\Models\SalesDocument;
use App\Modules\Sales\Models\SalesInvoice;
use App\Modules\Sales\Models\SalesInvoiceLine;
use App\Modules\Sales\Models\SalesOrder;
use App\Modules\Sales\Models\SalesOrderLine;
use App\Modules\Sales\Models\SalesQuote;
use App\Modules\Sales\Models\SalesReturn;
use Illuminate\Database\Eloquent\Builder;

/**
 * The document chain around a document (quote -> order -> deliveries -> invoices -> returns) for the
 * detail view: each link is {id, document_type, number, status, document_date, total}.
 */
final class DocumentLinks
{
    /** @return array<string, mixed> */
    public function for(SalesDocument $doc): array
    {
        return match (true) {
            $doc instanceof SalesQuote => [
                'previous_revision' => $this->one(SalesQuote::query()->whereKey($doc->previous_revision_id)),
                'next_revisions' => $this->many(SalesQuote::query()->where('previous_revision_id', $doc->id)),
                'order' => $this->one(SalesOrder::query()->whereKey($doc->converted_order_id)),
            ],
            $doc instanceof SalesOrder => [
                'quote' => $this->one(SalesQuote::query()->whereKey($doc->quote_id)),
                'deliveries' => $this->many(SalesDelivery::query()->where('order_id', $doc->id)),
                'invoices' => $this->many(SalesInvoice::query()->whereIn('id', SalesInvoiceLine::query()->select('document_id')
                    ->whereIn('order_line_id', SalesOrderLine::query()->select('id')->where('document_id', $doc->id)))),
            ],
            $doc instanceof SalesDelivery => [
                'order' => $this->one(SalesOrder::query()->whereKey($doc->order_id)),
                'invoices' => $this->many(SalesInvoice::query()->whereIn('id', SalesInvoiceLine::query()->select('document_id')
                    ->whereIn('delivery_line_id', SalesDeliveryLine::query()->select('id')->where('document_id', $doc->id)))),
                'invoice' => $this->one(SalesInvoice::query()->whereKey($doc->invoice_id)),
            ],
            $doc instanceof SalesInvoice => [
                'order' => $this->one(SalesOrder::query()->whereKey($doc->order_id)),
                'deliveries' => $this->many(SalesDelivery::query()->whereIn('id', SalesDeliveryLine::query()->select('document_id')
                    ->whereIn('id', SalesInvoiceLine::query()->select('delivery_line_id')->where('document_id', $doc->id)->whereNotNull('delivery_line_id')))),
                'returns' => $this->many(SalesReturn::query()->where('invoice_id', $doc->id)),
                'credit_notes' => $this->many(SalesInvoice::query()->where('original_invoice_id', $doc->id)),
                'original_invoice' => $this->one(SalesInvoice::query()->whereKey($doc->original_invoice_id)),
                'return' => $this->one(SalesReturn::query()->whereKey($doc->return_id)),
            ],
            $doc instanceof SalesReturn => [
                'invoice' => $this->one(SalesInvoice::query()->whereKey($doc->invoice_id)),
                'credit_invoice' => $this->one(SalesInvoice::query()->whereKey($doc->credit_invoice_id)),
            ],
            default => [],
        };
    }

    /**
     * @param  Builder<covariant SalesDocument>  $query
     * @return array<string, mixed>|null
     */
    private function one(Builder $query): ?array
    {
        $doc = $query->first();

        return $doc instanceof SalesDocument ? self::link($doc) : null;
    }

    /**
     * @param  Builder<covariant SalesDocument>  $query
     * @return list<array<string, mixed>>
     */
    private function many(Builder $query): array
    {
        return array_values($query->orderBy('document_date')->orderBy('id')->limit(200)->get()
            ->map(static fn (SalesDocument $d): array => self::link($d))->all());
    }

    /** @return array<string, mixed> */
    public static function link(SalesDocument $doc): array
    {
        return [
            'id' => $doc->id, 'document_type' => $doc instanceof SalesInvoice && $doc->isCreditNote() ? 'sales_credit_note' : $doc::kind()->value,
            'number' => $doc->number, 'status' => $doc->currentStatus(), 'document_date' => $doc->document_date->format('Y-m-d'),
            'total' => (string) $doc->total, 'currency_code' => $doc->currency_code,
        ];
    }
}
