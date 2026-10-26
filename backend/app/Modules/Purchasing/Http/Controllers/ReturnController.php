<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Modules\Purchasing\Http\Requests\ActionRequest;
use App\Modules\Purchasing\Http\Requests\DocumentRequest;
use App\Modules\Purchasing\Models\PurchaseReturn;
use App\Modules\Purchasing\Services\ReturnService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/** Returns are created from an invoice or a receipt; here they are edited and moved along. */
final class ReturnController extends PurchaseDocumentController
{
    // Services are resolved per call: the router keeps controller instances between requests.

    protected function model(): string
    {
        return PurchaseReturn::class;
    }

    public function update(DocumentRequest $request, string $id): JsonResponse
    {
        $return = $this->purchaseReturn($id, 'update');

        return $this->respond(app(ReturnService::class)->update($return, $request->headerData(), $request->lineData(), (int) $request->optionalVersion()));
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        Gate::authorize('delete', PurchaseReturn::class);
        app(ReturnService::class)->delete($this->purchaseReturn($id, 'delete'), self::version($request));

        return ApiResponse::noContent();
    }

    public function approve(ActionRequest $request, string $id): JsonResponse
    {
        return $this->respond(app(ReturnService::class)->approve($this->purchaseReturn($id, 'approve'), $request->optionalVersion(), $this->actor($request)));
    }

    public function ship(ActionRequest $request, string $id): JsonResponse
    {
        [$return, $replayed] = app(ReturnService::class)->ship($this->purchaseReturn($id, 'ship'), $request->optionalVersion(), $this->actor($request));

        return $this->respond($return, replayed: $replayed);
    }

    public function debit(ActionRequest $request, string $id): JsonResponse
    {
        [$return, $replayed] = app(ReturnService::class)->debit($this->purchaseReturn($id, 'debit'), $request->optionalVersion(), $this->actor($request));

        return $this->respond($return, replayed: $replayed);
    }

    public function cancel(ActionRequest $request, string $id): JsonResponse
    {
        return $this->respond(app(ReturnService::class)->cancel($this->purchaseReturn($id, 'update'), $request->optionalVersion(), $this->actor($request)));
    }

    private function purchaseReturn(string $id, string $ability): PurchaseReturn
    {
        /** @var PurchaseReturn */
        return $this->document($id, $ability);
    }
}
