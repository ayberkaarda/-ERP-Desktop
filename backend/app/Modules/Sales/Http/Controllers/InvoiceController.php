<?php

declare(strict_types=1);

namespace App\Modules\Sales\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Modules\Sales\Http\Requests\ActionRequest;
use App\Modules\Sales\Http\Requests\DocumentRequest;
use App\Modules\Sales\Models\SalesInvoice;
use App\Modules\Sales\Services\InvoiceService;
use App\Modules\Sales\Services\ReturnService;
use App\Modules\Sales\Support\Messages;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

final class InvoiceController extends SalesDocumentController
{
    public function __construct(
        private readonly InvoiceService $invoices,
        private readonly ReturnService $returns,
    ) {}

    protected function model(): string
    {
        return SalesInvoice::class;
    }

    protected function extraFilters(): array
    {
        return ['invoice_type'];
    }

    public function store(DocumentRequest $request): JsonResponse
    {
        return $this->respond($this->invoices->create($request->headerData(), $request->lineData() ?? [], $this->actor($request), $this->canOverridePrice($request)), status: 201);
    }

    public function update(DocumentRequest $request, string $id): JsonResponse
    {
        $invoice = $this->invoice($id, 'update');

        return $this->respond($this->invoices->update($invoice, $request->headerData(), $request->lineData(), (int) $request->optionalVersion(), $this->actor($request), $this->canOverridePrice($request)));
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        Gate::authorize('delete', SalesInvoice::class);
        $this->invoices->delete($this->invoice($id, 'delete'), QuoteController::version($request));

        return ApiResponse::noContent();
    }

    /** Body: version?, credit_override_reason?. Issued invoices are returned unchanged (meta.replayed). */
    public function issue(ActionRequest $request, string $id): JsonResponse
    {
        [$invoice, $replayed, $warnings] = $this->invoices->issue($this->invoice($id, 'issue'), $request->optionalVersion(),
            $request->text('credit_override_reason'), $this->canOverrideCredit($request), $this->actor($request));

        return $this->respond($invoice, $this->warningsMeta($warnings), replayed: $replayed);
    }

    /** Body: date (Y-m-d, default today), reason (required), reverse_stock (bool), version?. */
    public function reverse(ActionRequest $request, string $id): JsonResponse
    {
        $reason = $request->text('reason') ?? Messages::fail('reason', 'reason_required');
        [$invoice, $replayed] = $this->invoices->reverse($this->invoice($id, 'reverse'), $request->optionalVersion(),
            $request->text('date') ?? now()->toDateString(), $reason, $request->boolean('reverse_stock'), $this->actor($request));

        return $this->respond($invoice, replayed: $replayed);
    }

    public function cancel(ActionRequest $request, string $id): JsonResponse
    {
        return $this->respond($this->invoices->cancel($this->invoice($id, 'update'), $request->optionalVersion(), $this->actor($request)));
    }

    /** Return draft of the issued invoice (lines: invoice_line_id, quantity, lot_no, serial_numbers; omitted = all returnable). */
    public function returns(DocumentRequest $request, string $id): JsonResponse
    {
        $invoice = $this->invoice($id, 'view');

        return $this->respond($this->returns->createFromInvoice($invoice, $request->headerData(), $request->lineData(), $this->actor($request)), status: 201);
    }

    private function invoice(string $id, string $ability): SalesInvoice
    {
        /** @var SalesInvoice $invoice */
        $invoice = $this->find($id);
        Gate::authorize($ability, $invoice);

        return $invoice;
    }
}
