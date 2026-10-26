<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Instruments\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Modules\Treasury\Banking\Support\Extension;
use App\Modules\Treasury\Instruments\Models\Instrument;
use App\Modules\Treasury\Instruments\Services\Instruments;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class InstrumentController
{
    public function index(Request $request): JsonResponse
    {
        Extension::authorize('treasury.instruments.view');
        $input = $request->validate(['kind' => 'sometimes|in:cheque,note', 'direction' => 'sometimes|in:received,issued',
            'status' => 'sometimes|in:draft,portfolio,issued,collection,pledged,cleared,endorsed,dishonoured,returned',
            'party_id' => 'sometimes|uuid', 'currency_code' => 'sometimes|string|size:3', 'q' => 'sometimes|string|max:100',
            'page' => 'sometimes|integer|min:1', 'per_page' => 'sometimes|integer|min:1|max:100']);
        $query = Instrument::query()->orderBy('due_date')->orderBy('id');
        foreach (['kind', 'direction', 'status', 'party_id', 'currency_code'] as $filter) {
            if (isset($input[$filter])) {
                $query->where($filter, $input[$filter]);
            }
        }
        if (isset($input['q'])) {
            $query->where('instrument_number', 'ilike', '%'.str_replace(['%', '_'], ['\\%', '\\_'], (string) $input['q']).'%');
        }
        $page = $query->paginate((int) ($input['per_page'] ?? 25));

        return ApiResponse::success($page->items(), ['pagination' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()]]);
    }

    public function show(string $id, Instruments $service): JsonResponse
    {
        Extension::authorize('treasury.instruments.view');

        return ApiResponse::success($service->detail(Instrument::query()->findOrFail($id)));
    }

    public function store(Request $request, Instruments $service): JsonResponse
    {
        Extension::authorize('treasury.instruments.create');
        $input = $this->input($request, true);
        $this->sourcePermissions($input['allocations'] ?? []);

        return ApiResponse::created($service->detail($service->create($input)));
    }

    public function update(Request $request, string $id, Instruments $service): JsonResponse
    {
        Extension::authorize('treasury.instruments.update');
        $service->authorizeSources(Instrument::query()->findOrFail($id));
        $version = $request->validate(['version' => 'required|integer|min:1']);
        $input = $this->input($request, false);
        $this->sourcePermissions($input['allocations'] ?? []);

        return ApiResponse::success($service->detail($service->update($id, (int) $version['version'], $input)));
    }

    public function destroy(Request $request, string $id, Instruments $service): JsonResponse
    {
        Extension::authorize('treasury.instruments.delete');
        $input = $request->validate(['version' => 'required|integer|min:1']);
        $service->delete($id, (int) $input['version']);

        return ApiResponse::noContent();
    }

    public function action(Request $request, string $id, string $action, Instruments $service): JsonResponse
    {
        $permission = match ($action) {
            'endorse' => 'endorse', 'clear' => 'clear', 'dishonour', 'return' => 'reverse', default => 'post',
        };
        Extension::authorize('treasury.instruments.'.$permission);
        $input = $request->validate([
            'version' => 'required|integer|min:1', 'document_date' => 'required|date_format:Y-m-d',
            'reason' => in_array($action, ['dishonour', 'return'], true) ? 'required|string|max:1000' : 'sometimes|nullable|string|max:1000',
            'account_id' => $action === 'clear' ? 'required|uuid' : 'prohibited',
            'party_id' => $action === 'endorse' ? 'required|uuid' : 'prohibited',
            'allocations' => $action === 'endorse' ? 'sometimes|array|max:100' : 'prohibited',
            'allocations.*' => 'array:invoice_module,invoice_id,amount', 'allocations.*.invoice_module' => 'required|in:sales,purchasing',
            'allocations.*.invoice_id' => 'required|uuid', 'allocations.*.amount' => 'required|string|regex:/^\d{1,16}(\.\d{1,4})?$/|gt:0',
        ]);
        $instrument = Instrument::query()->findOrFail($id);
        $this->sourcePermissions($service->detail($instrument)['allocations']);
        $this->sourcePermissions($input['allocations'] ?? []);

        return ApiResponse::success($service->detail($service->act($id, $action, (int) $input['version'], $input)));
    }

    /** @return array<string, mixed> */
    private function input(Request $request, bool $create): array
    {
        $required = $create ? 'required' : 'sometimes';

        return $request->validate([
            'kind' => $required.'|in:cheque,note', 'direction' => $required.'|in:received,issued', 'instrument_number' => $required.'|string|max:100',
            'party_id' => $required.'|uuid', 'amount' => $required.'|string|regex:/^\d{1,16}(\.\d{1,4})?$/|gt:0',
            'currency_code' => $required.'|string|regex:/^[A-Z]{3}$/', 'fx_rate' => $required.'|string|regex:/^\d{1,14}(\.\d{1,6})?$/|gt:0',
            'issue_date' => $required.'|date_format:Y-m-d', 'due_date' => $required.'|date_format:Y-m-d',
            'bank_name' => 'sometimes|nullable|string|max:255', 'drawer' => 'sometimes|nullable|string|max:255', 'reference' => 'sometimes|nullable|string|max:255',
            'allocations' => 'sometimes|array|max:100', 'allocations.*' => 'array:invoice_module,invoice_id,amount',
            'allocations.*.invoice_module' => 'required|in:sales,purchasing', 'allocations.*.invoice_id' => 'required|uuid',
            'allocations.*.amount' => 'required|string|regex:/^\d{1,16}(\.\d{1,4})?$/|gt:0',
        ]);
    }

    private function sourcePermissions(mixed $allocations): void
    {
        if (! is_array($allocations)) {
            return;
        }
        foreach ($allocations as $allocation) {
            if (is_array($allocation) && isset($allocation['invoice_module'])) {
                Extension::authorize($allocation['invoice_module'] === 'sales' ? 'sales.invoices.view' : 'purchasing.invoices.view');
            }
        }
    }
}
