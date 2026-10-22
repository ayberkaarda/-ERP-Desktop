<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Modules\Purchasing\Http\Requests\ActionRequest;
use App\Modules\Purchasing\Http\Requests\DocumentRequest;
use App\Modules\Purchasing\Models\PurchaseReceipt;
use App\Modules\Purchasing\Services\InvoiceService;
use App\Modules\Purchasing\Services\ReceiptService;
use App\Modules\Purchasing\Services\ReturnService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

final class ReceiptController extends PurchaseDocumentController
{
    // Services are resolved per call: the router keeps controller instances between requests.

    protected function model(): string
    {
        return PurchaseReceipt::class;
    }

    /** A receipt without an order (only with purchasing.allow_direct_receipt). */
    public function store(DocumentRequest $request): JsonResponse
    {
        return $this->respond(app(ReceiptService::class)->createDirect($request->headerData(), $request->lineData() ?? [], $this->actor($request), $this->canOverridePrice($request)), status: 201);
    }

    public function update(DocumentRequest $request, string $id): JsonResponse
    {
        $receipt = $this->receipt($id, 'update');

        return $this->respond(app(ReceiptService::class)->update($receipt, $request->headerData(), $request->lineData(), (int) $request->optionalVersion(), $this->actor($request), $this->canOverridePrice($request)));
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        Gate::authorize('delete', PurchaseReceipt::class);
        app(ReceiptService::class)->delete($this->receipt($id, 'delete'), self::version($request));

        return ApiResponse::noContent();
    }

    /** Posted receipts are returned unchanged (meta.replayed). */
    public function post(ActionRequest $request, string $id): JsonResponse
    {
        [$receipt, $replayed] = app(ReceiptService::class)->post($this->receipt($id, 'post'), $request->optionalVersion(), $this->actor($request));

        return $this->respond($receipt, replayed: $replayed);
    }

    /** Draft: cancel (update). Posted: reversal with body reason (required) and date (needs reverse). */
    public function cancel(ActionRequest $request, string $id): JsonResponse
    {
        $receipt = $this->receipt($id, 'view');

        return $this->respond(app(ReceiptService::class)->cancel($receipt, $request->optionalVersion(), $request->text('reason'), $request->text('date'), $this->actor($request)));
    }

    /** Invoice draft of the receipt (lines: receipt_line_id, quantity, unit_price; omitted = everything open). */
    public function invoice(DocumentRequest $request, string $id): JsonResponse
    {
        $receipt = $this->receipt($id, 'view');

        return $this->respond(app(InvoiceService::class)->createFromReceipt($receipt, $request->headerData(), $request->lineData(), $this->actor($request),
            $this->canOverridePrice($request)), status: 201);
    }

    /** Return draft of not yet invoiced goods (lines: receipt_line_id, quantity, lot_no, serial_numbers). */
    public function returns(DocumentRequest $request, string $id): JsonResponse
    {
        $receipt = $this->receipt($id, 'view');

        return $this->respond(app(ReturnService::class)->createFromReceipt($receipt, $request->headerData(), $request->lineData(), $this->actor($request)), status: 201);
    }

    private function receipt(string $id, string $ability): PurchaseReceipt
    {
        /** @var PurchaseReceipt */
        return $this->document($id, $ability);
    }
}
