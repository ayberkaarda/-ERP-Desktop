<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Modules\Purchasing\Http\Requests\ActionRequest;
use App\Modules\Purchasing\Http\Requests\DocumentRequest;
use App\Modules\Purchasing\Models\PurchaseInvoice;
use App\Modules\Purchasing\Models\PurchaseOrder;
use App\Modules\Purchasing\Models\PurchaseOrderLine;
use App\Modules\Purchasing\Models\PurchaseReceipt;
use App\Modules\Purchasing\Models\PurchaseReceiptLine;
use App\Modules\Purchasing\Services\DocumentLinks;
use App\Modules\Purchasing\Services\InvoiceService;
use App\Modules\Purchasing\Services\ReturnService;
use App\Modules\Purchasing\Support\Messages;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * Supplier invoices and debit notes. Extra filters: invoice_type, match_status; filter[open]=1 =
 * booked or partially paid with a balance.
 */
final class InvoiceController extends PurchaseDocumentController
{
    // Services are resolved per call: the router keeps controller instances between requests.

    protected function model(): string
    {
        return PurchaseInvoice::class;
    }

    protected function filters(): array
    {
        return [...parent::filters(), 'invoice_type', 'match_status'];
    }

    protected function searchable(): array
    {
        return [...parent::searchable(), 'supplier_invoice_no'];
    }

    protected function customFilter(Builder $query, array $custom): void
    {
        if (isset($custom['open']) && in_array($custom['open'], ['1', 'true'], true)) {
            $query->whereIn('status', ['booked', 'partially_paid'])->where('balance_due', '>', 0);
        }
    }

    protected function exportHeadings(): array
    {
        return [...parent::exportHeadings(), 'invoice_type', 'supplier_invoice_no', 'match_status', 'paid_amount', 'balance_due'];
    }

    protected function exportRow(Model $doc): array
    {
        /** @var PurchaseInvoice $doc */
        return [...parent::exportRow($doc), $doc->invoice_type->value, $doc->supplier_invoice_no, $doc->match_status, (string) $doc->paid_amount, (string) $doc->balance_due];
    }

    protected function details(Model $doc): array
    {
        /** @var PurchaseInvoice $doc */
        return ['links' => app(DocumentLinks::class)->for($doc), 'match' => app(InvoiceService::class)->match($doc)];
    }

    public function store(DocumentRequest $request): JsonResponse
    {
        $this->authorizeSources($request->lineData() ?? []);

        return $this->respond(app(InvoiceService::class)->create($request->headerData(), $request->lineData() ?? [], $this->actor($request), $this->canOverridePrice($request)), status: 201);
    }

    public function update(DocumentRequest $request, string $id): JsonResponse
    {
        $invoice = $this->invoice($id, 'update');
        $this->authorizeSources($request->lineData() ?? []);

        return $this->respond(app(InvoiceService::class)->update($invoice, $request->headerData(), $request->lineData(), (int) $request->optionalVersion(), $this->actor($request), $this->canOverridePrice($request)));
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        Gate::authorize('delete', PurchaseInvoice::class);
        app(InvoiceService::class)->delete($this->invoice($id, 'delete'), self::version($request));

        return ApiResponse::noContent();
    }

    /**
     * Body: version?, match_override_reason? (needs purchasing.match_override over a variance in
     * block mode). Booked invoices are returned unchanged (meta.replayed); above the approval
     * threshold the invoice goes to pending_approval instead.
     */
    public function book(ActionRequest $request, string $id): JsonResponse
    {
        [$invoice, $replayed, $warnings] = app(InvoiceService::class)->book($this->invoice($id, 'book'), $request->optionalVersion(),
            $request->text('match_override_reason'), $this->permits($request, 'purchasing.match_override'), $this->actor($request));

        return $this->respond($invoice, $this->warningsMeta($warnings), replayed: $replayed);
    }

    /** Body: date (Y-m-d, default today), reason (required), reverse_stock (bool), version?. */
    public function reverse(ActionRequest $request, string $id): JsonResponse
    {
        $invoice = $this->invoice($id, 'reverse');
        $reason = $request->text('reason') ?? Messages::fail('reason', 'reason_required');
        [$invoice, $replayed] = app(InvoiceService::class)->reverse($invoice, $request->optionalVersion(),
            $request->text('date') ?? now()->toDateString(), $reason, $request->boolean('reverse_stock'), $this->actor($request));

        return $this->respond($invoice, replayed: $replayed);
    }

    public function cancel(ActionRequest $request, string $id): JsonResponse
    {
        return $this->respond(app(InvoiceService::class)->cancel($this->invoice($id, 'update'), $request->optionalVersion(), $this->actor($request)));
    }

    /** Three-way match of the invoice (stored once booked, computed for drafts). */
    public function match(string $id): JsonResponse
    {
        Gate::authorize('viewAny', PurchaseInvoice::class);
        $invoice = $this->invoice($id, 'view');

        return ApiResponse::success(app(InvoiceService::class)->match($invoice));
    }

    /** Return draft of the booked invoice (lines: invoice_line_id, quantity, lot_no, serial_numbers; omitted = all returnable). */
    public function returns(DocumentRequest $request, string $id): JsonResponse
    {
        $invoice = $this->invoice($id, 'view');

        return $this->respond(app(ReturnService::class)->createFromInvoice($invoice, $request->headerData(), $request->lineData(), $this->actor($request)), status: 201);
    }

    /**
     * Lines copied from orders or receipts need view permission on those documents, as the
     * conversion endpoints do.
     *
     * @param  list<array<string, mixed>>  $lines
     */
    private function authorizeSources(array $lines): void
    {
        $ids = static fn (string $key): array => array_values(array_filter(array_map(
            static fn (array $l): ?string => is_string($l[$key] ?? null) ? $l[$key] : null, $lines)));
        $receiptLines = $ids('receipt_line_id');
        $orderLines = $ids('order_line_id');

        if ($receiptLines !== []) {
            foreach (PurchaseReceipt::query()->whereIn('id', PurchaseReceiptLine::query()->select('document_id')->whereIn('id', $receiptLines))->get() as $receipt) {
                Gate::authorize('view', $receipt);
            }
        }

        if ($orderLines !== []) {
            foreach (PurchaseOrder::query()->whereIn('id', PurchaseOrderLine::query()->select('document_id')->whereIn('id', $orderLines))->get() as $order) {
                Gate::authorize('view', $order);
            }
        }
    }

    private function invoice(string $id, string $ability): PurchaseInvoice
    {
        /** @var PurchaseInvoice */
        return $this->document($id, $ability);
    }
}
