<?php

declare(strict_types=1);

namespace App\Modules\Sales\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Modules\Sales\Http\Requests\ActionRequest;
use App\Modules\Sales\Http\Requests\DocumentRequest;
use App\Modules\Sales\Http\Resources\DocumentResource;
use App\Modules\Sales\Models\SalesOrder;
use App\Modules\Sales\Models\SalesQuote;
use App\Modules\Sales\Services\QuoteService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

final class QuoteController extends SalesDocumentController
{
    public function __construct(private readonly QuoteService $quotes) {}

    protected function model(): string
    {
        return SalesQuote::class;
    }

    public function store(DocumentRequest $request): JsonResponse
    {
        $quote = $this->quotes->create($request->headerData(), $request->lineData() ?? [], $this->actor($request), $this->canOverridePrice($request));

        return $this->respond($quote, status: 201);
    }

    public function update(DocumentRequest $request, string $id): JsonResponse
    {
        $quote = $this->quote($id, 'update');

        return $this->respond($this->quotes->update($quote, $request->headerData(), $request->lineData(), (int) $request->optionalVersion(), $this->actor($request), $this->canOverridePrice($request)));
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        Gate::authorize('delete', SalesQuote::class);
        $this->quotes->delete($this->quote($id, 'delete'), self::version($request));

        return ApiResponse::noContent();
    }

    public function send(ActionRequest $request, string $id): JsonResponse
    {
        return $this->respond($this->quotes->send($this->quote($id, 'update'), $request->optionalVersion(), $this->actor($request)));
    }

    public function accept(ActionRequest $request, string $id): JsonResponse
    {
        return $this->respond($this->quotes->accept($this->quote($id, 'update'), $request->optionalVersion(), $this->actor($request)));
    }

    public function reject(ActionRequest $request, string $id): JsonResponse
    {
        return $this->respond($this->quotes->reject($this->quote($id, 'update'), $request->optionalVersion(), $request->text('reason'), $this->actor($request)));
    }

    public function cancel(ActionRequest $request, string $id): JsonResponse
    {
        return $this->respond($this->quotes->cancel($this->quote($id, 'update'), $request->optionalVersion(), $this->actor($request)));
    }

    public function revise(ActionRequest $request, string $id): JsonResponse
    {
        return $this->respond($this->quotes->revise($this->quote($id, 'update'), $request->optionalVersion(), $this->actor($request)), status: 201);
    }

    /** Creates the order draft; the quote is returned in meta. */
    public function convert(DocumentRequest $request, string $id): JsonResponse
    {
        Gate::authorize('create', SalesOrder::class);
        $quote = $this->quote($id, 'update');
        $order = $this->quotes->convert($quote, $request->headerData(), $request->optionalVersion(), $this->actor($request));
        $order->load('lines');

        return ApiResponse::success((new DocumentResource($order))->resolve($request), [
            'quote' => ['id' => $quote->id, 'status' => 'converted'],
        ], 201);
    }

    private function quote(string $id, string $ability): SalesQuote
    {
        /** @var SalesQuote $quote */
        $quote = $this->find($id);
        Gate::authorize($ability, $quote);

        return $quote;
    }

    public static function version(Request $request): ?int
    {
        $version = $request->input('version', $request->query('version'));

        return is_numeric($version) ? (int) $version : null;
    }
}
