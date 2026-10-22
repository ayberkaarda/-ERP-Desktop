<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Modules\Purchasing\Http\Requests\ActionRequest;
use App\Modules\Purchasing\Http\Requests\DocumentRequest;
use App\Modules\Purchasing\Http\Resources\DocumentResource;
use App\Modules\Purchasing\Http\Resources\RequestResource;
use App\Modules\Purchasing\Http\Resources\RfqResource;
use App\Modules\Purchasing\Models\PurchaseRequest;
use App\Modules\Purchasing\Models\PurchaseRequestLine;
use App\Modules\Purchasing\Services\DocumentLinks;
use App\Modules\Purchasing\Services\Quantities;
use App\Modules\Purchasing\Services\RequestService;
use App\Modules\Purchasing\Services\RfqService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * Purchase requests: filters status, warehouse_id, requested_by; supplier = a suggested supplier;
 * q = number and notes; sorts document_date, number, needed_by, estimated_total, status, created_at.
 */
final class RequestController extends PurchasingController
{
    // Services are resolved per call: the router keeps controller instances between requests.

    protected function model(): string
    {
        return PurchaseRequest::class;
    }

    protected function resource(): string
    {
        return RequestResource::class;
    }

    protected function lineModel(): string
    {
        return PurchaseRequestLine::class;
    }

    protected function filters(): array
    {
        return ['status', 'warehouse_id', 'requested_by'];
    }

    protected function sorts(): array
    {
        return ['document_date', 'number', 'needed_by', 'estimated_total', 'status', 'created_at'];
    }

    protected function searchable(): array
    {
        return ['number', 'notes'];
    }

    protected function supplierFilter(Builder $query, string $partyId): void
    {
        $query->whereIn('id', PurchaseRequestLine::query()->select('document_id')->where('suggested_supplier_id', $partyId));
    }

    protected function exportHeadings(): array
    {
        return ['number', 'status', 'document_date', 'needed_by', 'currency_code', 'estimated_total'];
    }

    protected function exportRow(Model $doc): array
    {
        /** @var PurchaseRequest $doc */
        return [$doc->number, $doc->status->value, $doc->document_date->format('Y-m-d'), $doc->needed_by?->format('Y-m-d'), $doc->currency_code, (string) $doc->estimated_total];
    }

    protected function details(Model $doc): array
    {
        /** @var PurchaseRequest $doc */
        $quantities = app(Quantities::class);
        $lines = [];

        foreach ($doc->lines as $line) {
            $lines[$line->id] = (string) $quantities->orderedOnRequest($line->id);
        }

        return ['links' => app(DocumentLinks::class)->for($doc, self::viewer()), 'ordered_quantities' => $lines];
    }

    public function store(DocumentRequest $request): JsonResponse
    {
        return $this->respond(app(RequestService::class)->create($request->headerData(), $request->lineData() ?? [], $this->actor($request)), status: 201);
    }

    /** Drafts are rewritten; a rejected request is reopened as a draft by the edit. */
    public function update(DocumentRequest $request, string $id): JsonResponse
    {
        $doc = $this->request($id, 'update');

        return $this->respond(app(RequestService::class)->update($doc, $request->headerData(), $request->lineData(), (int) $request->optionalVersion()));
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        Gate::authorize('delete', PurchaseRequest::class);
        app(RequestService::class)->delete($this->request($id, 'delete'), self::version($request));

        return ApiResponse::noContent();
    }

    public function submit(ActionRequest $request, string $id): JsonResponse
    {
        return $this->respond(app(RequestService::class)->submit($this->request($id, 'update'), $request->optionalVersion(), $this->actor($request))->refresh());
    }

    public function cancel(ActionRequest $request, string $id): JsonResponse
    {
        return $this->respond(app(RequestService::class)->cancel($this->request($id, 'update'), $request->optionalVersion(), $this->actor($request)));
    }

    /** RFQ draft from the request (supplier_ids, lines: request_line_id, quantity; omitted = everything open). */
    public function rfq(DocumentRequest $request, string $id): JsonResponse
    {
        $doc = $this->request($id, 'view');
        $rfq = app(RfqService::class)->createFromRequest($doc, $request->headerData(), $request->lineData(), $this->actor($request));
        $rfq->load(['lines', 'suppliers']);

        return ApiResponse::success((new RfqResource($rfq))->resolve($request), status: 201);
    }

    /** Order draft of one supplier from the request (party_id, lines: request_line_id, quantity, unit_price). */
    public function orders(DocumentRequest $request, string $id): JsonResponse
    {
        $doc = $this->request($id, 'view');
        $order = app(RequestService::class)->createOrder($doc, $request->headerData(), $request->lineData(), $this->actor($request), $this->canOverridePrice($request));
        $order->load('lines');

        return ApiResponse::success((new DocumentResource($order))->resolve($request), status: 201);
    }

    private function request(string $id, string $ability): PurchaseRequest
    {
        Gate::authorize($ability, PurchaseRequest::class);
        /** @var PurchaseRequest $doc */
        $doc = $this->find($id);
        Gate::authorize($ability, $doc);

        return $doc;
    }
}
