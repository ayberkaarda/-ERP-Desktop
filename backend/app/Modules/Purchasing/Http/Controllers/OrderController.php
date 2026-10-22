<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Modules\Purchasing\Http\Requests\ActionRequest;
use App\Modules\Purchasing\Http\Requests\DocumentRequest;
use App\Modules\Purchasing\Models\PurchaseOrder;
use App\Modules\Purchasing\Services\InvoiceService;
use App\Modules\Purchasing\Services\OrderService;
use App\Modules\Purchasing\Services\ReceiptService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

final class OrderController extends PurchaseDocumentController
{
    // Services are resolved per call: the router keeps controller instances between requests.

    protected function model(): string
    {
        return PurchaseOrder::class;
    }

    public function store(DocumentRequest $request): JsonResponse
    {
        return $this->respond(app(OrderService::class)->create($request->headerData(), $request->lineData() ?? [], $this->actor($request), $this->canOverridePrice($request)), status: 201);
    }

    public function update(DocumentRequest $request, string $id): JsonResponse
    {
        $order = $this->order($id, 'update');

        return $this->respond(app(OrderService::class)->update($order, $request->headerData(), $request->lineData(), (int) $request->optionalVersion(), $this->actor($request), $this->canOverridePrice($request)));
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        Gate::authorize('delete', PurchaseOrder::class);
        app(OrderService::class)->delete($this->order($id, 'delete'), self::version($request));

        return ApiResponse::noContent();
    }

    /** Number, then approval above purchasing.require_approval_over or approved at once. */
    public function submit(ActionRequest $request, string $id): JsonResponse
    {
        return $this->respond(app(OrderService::class)->submit($this->order($id, 'approve'), $request->optionalVersion(), $this->actor($request))->refresh());
    }

    /** Body: the full draft payload (header fields, lines) plus version. */
    public function revise(DocumentRequest $request, string $id): JsonResponse
    {
        $order = $this->order($id, 'approve');

        return $this->respond(app(OrderService::class)->revise($order, $request->headerData(), $request->lineData(), (int) $request->optionalVersion(),
            $this->actor($request), $this->canOverridePrice($request))->refresh());
    }

    public function send(ActionRequest $request, string $id): JsonResponse
    {
        return $this->respond(app(OrderService::class)->send($this->order($id, 'update'), $request->optionalVersion(), $this->actor($request)));
    }

    public function cancel(ActionRequest $request, string $id): JsonResponse
    {
        return $this->respond(app(OrderService::class)->cancel($this->order($id, 'update'), $request->optionalVersion(), $this->actor($request)));
    }

    public function close(ActionRequest $request, string $id): JsonResponse
    {
        return $this->respond(app(OrderService::class)->close($this->order($id, 'approve'), $request->optionalVersion(), $this->actor($request)));
    }

    /** Receipt draft from the order (lines: order_line_id, quantity, lot_no, expiry_date, serial_numbers, location_id; omitted = all remaining). */
    public function receipts(DocumentRequest $request, string $id): JsonResponse
    {
        $order = $this->order($id, 'view');

        return $this->respond(app(ReceiptService::class)->createFromOrder($order, $request->headerData(), $request->lineData(), $this->actor($request)), status: 201);
    }

    /** Invoice draft from the order (lines: order_line_id, quantity, unit_price; omitted = all invoiceable). */
    public function invoices(DocumentRequest $request, string $id): JsonResponse
    {
        $order = $this->order($id, 'view');

        return $this->respond(app(InvoiceService::class)->createFromOrder($order, $request->headerData(), $request->lineData(), $this->actor($request),
            $this->canOverridePrice($request)), status: 201);
    }

    private function order(string $id, string $ability): PurchaseOrder
    {
        /** @var PurchaseOrder */
        return $this->document($id, $ability);
    }
}
