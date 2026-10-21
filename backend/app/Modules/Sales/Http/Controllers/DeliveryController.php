<?php

declare(strict_types=1);

namespace App\Modules\Sales\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Modules\Sales\Enums\DeliveryStatus;
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
    public function __construct(
        private readonly DeliveryService $deliveries,
        private readonly InvoiceService $invoices,
    ) {}

    protected function model(): string
    {
        return SalesDelivery::class;
    }

    /** Direct delivery (no order); needs the company setting sales.allow_direct_delivery. */
    public function store(DocumentRequest $request): JsonResponse
    {
        return $this->respond($this->deliveries->createDirect($request->headerData(), $request->lineData() ?? [], $this->actor($request), $this->canOverridePrice($request)), status: 201);
    }

    public function update(DocumentRequest $request, string $id): JsonResponse
    {
        $delivery = $this->delivery($id, 'update');

        return $this->respond($this->deliveries->update($delivery, $request->headerData(), $request->lineData(), (int) $request->optionalVersion(), $this->actor($request), $this->canOverridePrice($request)));
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        Gate::authorize('delete', SalesDelivery::class);
        $this->deliveries->delete($this->delivery($id, 'delete'), QuoteController::version($request));

        return ApiResponse::noContent();
    }

    public function post(ActionRequest $request, string $id): JsonResponse
    {
        [$delivery, $replayed] = $this->deliveries->post($this->delivery($id, 'post'), $request->optionalVersion(), $this->actor($request));

        return $this->respond($delivery, replayed: $replayed);
    }

    /** Draft: cancel (update). Posted: reverse the stock (reverse; body reason required, date optional). */
    public function cancel(ActionRequest $request, string $id): JsonResponse
    {
        $delivery = $this->delivery($id, 'view');
        Gate::authorize($delivery->status === DeliveryStatus::Posted ? 'reverse' : 'update', $delivery);

        return $this->respond($this->deliveries->cancel($delivery, $request->optionalVersion(), $request->text('reason'), $request->text('date'), $this->actor($request)));
    }

    /** Invoice draft of the posted delivery (lines: delivery_line_id, quantity; omitted = all not invoiced). */
    public function invoice(DocumentRequest $request, string $id): JsonResponse
    {
        $delivery = $this->delivery($id, 'view');

        return $this->respond($this->invoices->createFromDelivery($delivery, $request->headerData(), $request->lineData(), $this->actor($request)), status: 201);
    }

    private function delivery(string $id, string $ability): SalesDelivery
    {
        /** @var SalesDelivery $delivery */
        $delivery = $this->find($id);
        Gate::authorize($ability, $delivery);

        return $delivery;
    }
}
