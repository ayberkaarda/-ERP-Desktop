<?php

declare(strict_types=1);

namespace App\Modules\Sales\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Modules\Sales\Http\Requests\ActionRequest;
use App\Modules\Sales\Http\Requests\DocumentRequest;
use App\Modules\Sales\Models\SalesDelivery;
use App\Modules\Sales\Services\DeliveryService;
use App\Modules\Sales\Services\InvoiceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

final class DeliveryController extends SalesDocumentController
{
    // Services are resolved per call: the router keeps controller instances between requests.
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
        return SalesDelivery::class;
    }

    /** Direct delivery (no order); needs the company setting sales.allow_direct_delivery. */
    public function store(DocumentRequest $request): JsonResponse
    {
        return $this->respond($this->deliveryService()->createDirect($request->headerData(), $request->lineData() ?? [], $this->actor($request), $this->canOverridePrice($request)), status: 201);
    }

    public function update(DocumentRequest $request, string $id): JsonResponse
    {
        $delivery = $this->delivery($id, 'update');

        return $this->respond($this->deliveryService()->update($delivery, $request->headerData(), $request->lineData(), (int) $request->optionalVersion(), $this->actor($request), $this->canOverridePrice($request)));
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        Gate::authorize('delete', SalesDelivery::class);
        $this->deliveryService()->delete($this->delivery($id, 'delete'), QuoteController::version($request));

        return ApiResponse::noContent();
    }

    public function post(ActionRequest $request, string $id): JsonResponse
    {
        [$delivery, $replayed] = $this->deliveryService()->post($this->delivery($id, 'post'), $request->optionalVersion(), $this->actor($request));

        return $this->respond($delivery, replayed: $replayed);
    }

    /** Draft: cancel (update). Posted: reverse the stock (reverse; body reason required, date optional). */
    public function cancel(ActionRequest $request, string $id): JsonResponse
    {
        // The exact permission (update for a draft, reverse for a posted delivery) is checked by the
        // service on the locked row, so a delivery posted meanwhile cannot be reversed with update.
        $delivery = $this->delivery($id, 'cancel');

        return $this->respond($this->deliveryService()->cancel($delivery, $request->optionalVersion(), $request->text('reason'), $request->text('date'), $this->actor($request)));
    }

    /** Invoice draft of the posted delivery (lines: delivery_line_id, quantity; omitted = all not invoiced). */
    public function invoice(DocumentRequest $request, string $id): JsonResponse
    {
        $delivery = $this->delivery($id, 'view');

        return $this->respond($this->invoiceService()->createFromDelivery($delivery, $request->headerData(), $request->lineData(), $this->actor($request)), status: 201);
    }

    private function delivery(string $id, string $ability): SalesDelivery
    {
        /** @var SalesDelivery $delivery */
        $delivery = $this->find($id);
        Gate::authorize($ability, $delivery);

        return $delivery;
    }
}
