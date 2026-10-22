<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Modules\Purchasing\Http\Requests\ActionRequest;
use App\Modules\Purchasing\Http\Requests\DocumentRequest;
use App\Modules\Purchasing\Http\Resources\DocumentResource;
use App\Modules\Purchasing\Http\Resources\RfqResource;
use App\Modules\Purchasing\Models\PurchaseOrder;
use App\Modules\Purchasing\Models\PurchaseRfq;
use App\Modules\Purchasing\Models\PurchaseRfqLine;
use App\Modules\Purchasing\Models\RfqSupplier;
use App\Modules\Purchasing\Services\RfqService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * Requests for quotation: filters status, currency_code, request_id; supplier = an invited
 * supplier; q = number and notes; sorts document_date, number, response_due, status, created_at.
 */
final class RfqController extends PurchasingController
{
    // Services are resolved per call: the router keeps controller instances between requests.

    protected function model(): string
    {
        return PurchaseRfq::class;
    }

    protected function resource(): string
    {
        return RfqResource::class;
    }

    protected function lineModel(): string
    {
        return PurchaseRfqLine::class;
    }

    protected function with(): array
    {
        return ['lines', 'suppliers', 'quotes'];
    }

    protected function filters(): array
    {
        return ['status', 'currency_code', 'request_id'];
    }

    protected function sorts(): array
    {
        return ['document_date', 'number', 'response_due', 'status', 'created_at'];
    }

    protected function searchable(): array
    {
        return ['number', 'notes'];
    }

    protected function supplierFilter(Builder $query, string $partyId): void
    {
        $query->whereIn('id', RfqSupplier::query()->select('rfq_id')->where('party_id', $partyId));
    }

    protected function exportHeadings(): array
    {
        return ['number', 'status', 'document_date', 'response_due', 'currency_code'];
    }

    protected function exportRow(Model $doc): array
    {
        /** @var PurchaseRfq $doc */
        return [$doc->number, $doc->status->value, $doc->document_date->format('Y-m-d'), $doc->response_due?->format('Y-m-d'), $doc->currency_code];
    }

    public function store(DocumentRequest $request): JsonResponse
    {
        return $this->respond(app(RfqService::class)->create($request->headerData(), $request->lineData() ?? [], $this->actor($request)), status: 201);
    }

    public function update(DocumentRequest $request, string $id): JsonResponse
    {
        $rfq = $this->rfq($id, 'update');

        return $this->respond(app(RfqService::class)->update($rfq, $request->headerData(), $request->lineData(), (int) $request->optionalVersion()));
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        Gate::authorize('delete', PurchaseRfq::class);
        app(RfqService::class)->delete($this->rfq($id, 'delete'), self::version($request));

        return ApiResponse::noContent();
    }

    public function send(ActionRequest $request, string $id): JsonResponse
    {
        return $this->respond(app(RfqService::class)->send($this->rfq($id, 'update'), $request->optionalVersion(), $this->actor($request)));
    }

    public function cancel(ActionRequest $request, string $id): JsonResponse
    {
        return $this->respond(app(RfqService::class)->cancel($this->rfq($id, 'update'), $request->optionalVersion(), $this->actor($request)));
    }

    /** Body: party_id, quotes [{rfq_line_id, unit_price, discount_percent, lead_time_days, valid_until, notes}] or declined: true. */
    public function quotes(DocumentRequest $request, string $id): JsonResponse
    {
        $rfq = $this->rfq($id, 'update');
        $data = $request->validated();
        $quotes = is_array($data['quotes'] ?? null) ? array_values(array_filter($data['quotes'], 'is_array')) : [];

        return $this->respond(app(RfqService::class)->quote($rfq, is_string($data['party_id'] ?? null) ? $data['party_id'] : '', $quotes, (bool) ($data['declined'] ?? false),
            $request->optionalVersion(), $this->actor($request)));
    }

    public function comparison(string $id): JsonResponse
    {
        Gate::authorize('viewAny', PurchaseRfq::class);
        $rfq = $this->rfq($id, 'view');

        return ApiResponse::success(app(RfqService::class)->comparison($rfq));
    }

    /** Body: party_id (whole RFQ) or lines [{rfq_line_id, party_id}]; creates one draft order per supplier. */
    public function award(DocumentRequest $request, string $id): JsonResponse
    {
        Gate::authorize('create', PurchaseOrder::class);
        $rfq = $this->rfq($id, 'award');
        $orders = app(RfqService::class)->award($rfq, [...$request->headerData(), 'lines' => $request->lineData()], $request->optionalVersion(), $this->actor($request));
        $rfq->refresh()->load($this->with());

        return ApiResponse::success([
            ...(new RfqResource($rfq))->resolve($request),
            'orders' => array_map(static fn (PurchaseOrder $o): array => (new DocumentResource($o->load('lines')))->resolve($request), $orders),
        ], status: 201);
    }

    private function rfq(string $id, string $ability): PurchaseRfq
    {
        Gate::authorize($ability, PurchaseRfq::class);
        /** @var PurchaseRfq $doc */
        $doc = $this->find($id);
        Gate::authorize($ability, $doc);

        return $doc;
    }
}
