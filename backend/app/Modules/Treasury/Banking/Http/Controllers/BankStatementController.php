<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Banking\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Modules\Treasury\Banking\Models\BankStatement;
use App\Modules\Treasury\Banking\Services\Statements;
use App\Modules\Treasury\Banking\Support\Extension;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

final class BankStatementController
{
    public function index(Request $request): JsonResponse
    {
        Extension::authorize('treasury.banking.view');
        $input = $request->validate(['q' => 'sometimes|string|max:100', 'account_id' => 'sometimes|uuid', 'status' => 'sometimes|in:imported,reconciled', 'page' => 'sometimes|integer|min:1', 'per_page' => 'sometimes|integer|min:1|max:100']);
        $query = BankStatement::query()->orderByDesc('start_date')->orderByDesc('id');
        foreach (['account_id', 'status'] as $filter) {
            if (isset($input[$filter])) {
                $query->where($filter, $input[$filter]);
            }
        }
        if (isset($input['q'])) {
            $query->where('bank_reference', 'ilike', '%'.str_replace(['%', '_'], ['\\%', '\\_'], $input['q']).'%');
        }
        $page = $query->paginate((int) ($input['per_page'] ?? 25));

        return ApiResponse::success($page->items(), ['pagination' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()]]);
    }

    public function show(string $id, Statements $statements): JsonResponse
    {
        Extension::authorize('treasury.banking.view');

        return ApiResponse::success($statements->detail(BankStatement::query()->findOrFail($id)));
    }

    public function preview(Request $request, Statements $statements): JsonResponse
    {
        Extension::authorize('treasury.banking.import');

        return ApiResponse::success($statements->preview($this->input($request))->toArray());
    }

    public function store(Request $request, Statements $statements): JsonResponse
    {
        Extension::authorize('treasury.banking.import');

        return ApiResponse::created($statements->detail($statements->import($this->input($request))));
    }

    public function action(Request $request, string $id, string $action, Statements $statements): JsonResponse
    {
        Extension::authorize($action === 'reopen' ? 'treasury.banking.reopen' : 'treasury.banking.reconcile');
        $input = $request->validate([
            'version' => 'required|integer|min:1',
            'line_id' => in_array($action, ['match', 'unmatch'], true) ? 'required|uuid' : 'prohibited',
            'payment_id' => $action === 'match' ? 'required_without:movement_id|prohibits:movement_id|uuid' : 'prohibited',
            'movement_id' => $action === 'match' ? 'required_without:payment_id|prohibits:payment_id|uuid' : 'prohibited',
            'reason' => $action === 'reopen' ? 'required|string|max:1000' : 'prohibited',
        ]);
        $statement = match ($action) {
            'match', 'unmatch' => $statements->match($id, (int) $input['version'], (string) $input['line_id'], $action === 'match' && isset($input['payment_id']) ? (string) $input['payment_id'] : null, $action === 'match' && isset($input['movement_id']) ? (string) $input['movement_id'] : null),
            'reconcile' => $statements->reconcile($id, (int) $input['version']),
            'reopen' => $statements->reopen($id, (int) $input['version'], (string) $input['reason']),
            default => abort(404),
        };

        return ApiResponse::success($statements->detail($statement));
    }

    public function suggestions(Request $request, string $id, Statements $statements): JsonResponse
    {
        Extension::authorize('treasury.banking.reconcile');
        $input = $request->validate(['line_id' => 'required|uuid', 'page' => 'sometimes|integer|min:1', 'per_page' => 'sometimes|integer|min:1|max:100', 'q' => 'sometimes|string|max:100']);

        $page = $statements->suggestions(BankStatement::query()->findOrFail($id), (string) $input['line_id'], (int) ($input['page'] ?? 1), (int) ($input['per_page'] ?? 25), $input['q'] ?? null);

        return ApiResponse::success($page['data'], ['pagination' => $page['pagination']]);
    }

    /** @return array<string, mixed> */
    private function input(Request $request): array
    {
        return $request->validate([
            'account_id' => 'required|uuid', 'format' => 'required|in:csv,mt940', 'content' => 'required|string|max:2097152',
            'currency_code' => 'sometimes|string|size:3', 'opening_balance' => 'sometimes|string|max:24', 'closing_balance' => 'sometimes|string|max:24',
            'bank_reference' => 'sometimes|nullable|string|max:255', 'delimiter' => 'sometimes|in:comma,semicolon,tab', 'decimal_separator' => ['sometimes', Rule::in(['.', ','])],
            'mapping' => 'sometimes|array:date,amount,reference,description,value_date', 'mapping.*' => 'string|max:100',
        ]);
    }
}
