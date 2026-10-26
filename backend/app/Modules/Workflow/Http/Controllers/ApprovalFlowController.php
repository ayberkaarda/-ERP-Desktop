<?php

declare(strict_types=1);

namespace App\Modules\Workflow\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Core\Http\ListQuery;
use App\Modules\Workflow\Http\Requests\DeleteApprovalFlowRequest;
use App\Modules\Workflow\Http\Requests\SaveApprovalFlowRequest;
use App\Modules\Workflow\Http\Resources\ApprovalFlowResource;
use App\Modules\Workflow\Models\ApprovalFlow;
use App\Modules\Workflow\Repositories\ApprovalFlowRepository;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

final class ApprovalFlowController
{
    public function __construct(private readonly ApprovalFlowRepository $repository) {}

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', ApprovalFlow::class);

        return ApiResponse::paginated(ListQuery::for(
            ApprovalFlow::query()->with('steps'), $request,
            ['name', 'document_type', 'created_at'], ['document_type', 'is_active'], ['name', 'document_type'],
        ), ApprovalFlowResource::class);
    }

    public function store(SaveApprovalFlowRequest $request): JsonResponse
    {
        Gate::authorize('create', ApprovalFlow::class);
        $flow = $this->repository->create($request->validated());

        return ApiResponse::created((new ApprovalFlowResource($flow))->resolve($request));
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $flow = ApprovalFlow::query()->findOrFail($id);
        Gate::authorize('view', $flow);

        return ApiResponse::success((new ApprovalFlowResource($flow->load('steps')))->resolve($request));
    }

    public function update(SaveApprovalFlowRequest $request, string $id): JsonResponse
    {
        $flow = ApprovalFlow::query()->findOrFail($id);
        Gate::authorize('update', $flow);
        $flow = $this->repository->update($flow, $request->validated());

        return ApiResponse::success((new ApprovalFlowResource($flow))->resolve($request));
    }

    public function destroy(DeleteApprovalFlowRequest $request, string $id): JsonResponse
    {
        $flow = ApprovalFlow::query()->findOrFail($id);
        Gate::authorize('delete', $flow);
        $this->repository->delete($flow, $request->integer('version'));

        return ApiResponse::noContent();
    }
}
