<?php

declare(strict_types=1);

namespace App\Modules\Sales\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Modules\Sales\Http\Requests\ActionRequest;
use App\Modules\Sales\Http\Requests\DocumentRequest;
use App\Modules\Sales\Models\SalesReturn;
use App\Modules\Sales\Services\ReturnService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * Returns are created from an invoice (POST /sales-invoices/{id}/returns).
 */
final class ReturnController extends SalesDocumentController
{
    // Services are resolved per call: the router keeps controller instances between requests.
    private function returnService(): ReturnService
    {
        return app(ReturnService::class);
    }

    protected function model(): string
    {
        return SalesReturn::class;
    }

    public function update(DocumentRequest $request, string $id): JsonResponse
    {
        $return = $this->salesReturn($id, 'update');

        return $this->respond($this->returnService()->update($return, $request->headerData(), $request->lineData(), (int) $request->optionalVersion()));
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        Gate::authorize('delete', SalesReturn::class);
        $this->returnService()->delete($this->salesReturn($id, 'delete'), QuoteController::version($request));

        return ApiResponse::noContent();
    }

    public function approve(ActionRequest $request, string $id): JsonResponse
    {
        return $this->respond($this->returnService()->approve($this->salesReturn($id, 'approve'), $request->optionalVersion(), $this->actor($request)));
    }

    public function receive(ActionRequest $request, string $id): JsonResponse
    {
        [$return, $replayed] = $this->returnService()->receive($this->salesReturn($id, 'receive'), $request->optionalVersion(), $this->actor($request));

        return $this->respond($return, replayed: $replayed);
    }

    public function credit(ActionRequest $request, string $id): JsonResponse
    {
        [$return, $replayed] = $this->returnService()->credit($this->salesReturn($id, 'credit'), $request->optionalVersion(), $this->actor($request));

        return $this->respond($return, replayed: $replayed);
    }

    public function cancel(ActionRequest $request, string $id): JsonResponse
    {
        return $this->respond($this->returnService()->cancel($this->salesReturn($id, 'update'), $request->optionalVersion(), $this->actor($request)));
    }

    private function salesReturn(string $id, string $ability): SalesReturn
    {
        /** @var SalesReturn $return */
        $return = $this->find($id);
        Gate::authorize($ability, $return);

        return $return;
    }
}
