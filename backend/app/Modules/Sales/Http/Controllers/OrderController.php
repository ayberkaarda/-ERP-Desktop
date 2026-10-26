<?php

declare(strict_types=1);

namespace App\Modules\Sales\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Modules\Sales\Http\Requests\ActionRequest;
use App\Modules\Sales\Http\Requests\DocumentRequest;
use App\Modules\Sales\Models\SalesOrder;
use App\Modules\Sales\Services\DeliveryService;
use App\Modules\Sales\Services\InvoiceService;
use App\Modules\Sales\Services\OrderService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

final class OrderController extends SalesDocumentController
{
    // Services are resolved per call: the router keeps controller instances between requests.
    private function orderService(): OrderService
    {
        return app(OrderService::class);
    }

    private function deliveryService(): DeliveryService
    {
        return app(DeliveryService::class);
    }

    private function invoiceService(): InvoiceService
    {
        return app(InvoiceService::class);
    }

    protected function model(): string
    {
        return SalesOrder::class;
    }

    public function store(DocumentRequest $request): JsonResponse
    {
        return $this->respond($this->orderService()->create($request->headerData(), $request->lineData() ?? [], $this->actor($request), $this->canOverridePrice($request)), status: 201);
    }

    public function update(DocumentRequest $request, string $id): JsonResponse
    {
        $order = $this->order($id, 'update');

        return $this->respond($this->orderService()->update($order, $request->headerData(), $request->lineData(), (int) $request->optionalVersion(), $this->actor($request), $this->canOverridePrice($request)));
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        Gate::authorize('delete', SalesOrder::class);
        $this->orderService()->delete($this->order($id, 'delete'), QuoteController::version($request));

        return ApiResponse::noContent();
    }

    /** Body: version?, credit_override_reason? (needs sales.credit_override over the limit in block mode). */
    public function confirm(ActionRequest $request, string $id): JsonResponse
    {
        [$order, $warnings] = $this->orderService()->confirm($this->order($id, 'approve'), $request->optionalVersion(), $request->text('credit_override_reason'),
            $this->canOverrideCredit($request), $this->actor($request));

        return $this->respond($order->refresh(), $this->warningsMeta($warnings));
    }

    /** Body: the full draft payload (header fields, lines) plus version and credit_override_reason. */
    public function revise(DocumentRequest $request, string $id): JsonResponse
    {
        $order = $this->order($id, 'approve');
        $reason = $request->input('credit_override_reason');
        [$order, $warnings] = $this->orderService()->revise($order, $request->headerData(), $request->lineData(), (int) $request->optionalVersion(),
            is_string($reason) ? $reason : null, $this->canOverrideCredit($request), $this->canOverridePrice($request), $this->actor($request));

        return $this->respond($order->refresh(), $this->warningsMeta($warnings));
    }

    public function cancel(ActionRequest $request, string $id): JsonResponse
    {
        return $this->respond($this->orderService()->cancel($this->order($id, 'update'), $request->optionalVersion(), $this->actor($request)));
    }

    public function close(ActionRequest $request, string $id): JsonResponse
    {
        return $this->respond($this->orderService()->close($this->order($id, 'approve'), $request->optionalVersion(), $this->actor($request)));
    }

    /** Delivery draft from the order (lines: order_line_id, quantity, lot_no, serial_numbers; omitted = all remaining). */
    public function deliveries(DocumentRequest $request, string $id): JsonResponse
    {
        $order = $this->order($id, 'view');

        return $this->respond($this->deliveryService()->createFromOrder($order, $request->headerData(), $request->lineData(), $this->actor($request)), status: 201);
    }

    /** Invoice draft from the order (lines: order_line_id, quantity; omitted = all invoiceable). */
    public function invoices(DocumentRequest $request, string $id): JsonResponse
    {
        $order = $this->order($id, 'view');

        return $this->respond($this->invoiceService()->createFromOrder($order, $request->headerData(), $request->lineData(), $this->actor($request)), status: 201);
    }

    private function order(string $id, string $ability): SalesOrder
    {
        /** @var SalesOrder $order */
        $order = $this->find($id);
        Gate::authorize($ability, $order);

        return $order;
    }
}
