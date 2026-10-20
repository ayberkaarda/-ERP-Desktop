<?php

declare(strict_types=1);

namespace App\Modules\Workflow\Http\Controllers;

use App\Core\Http\ApiException;
use App\Core\Http\ApiResponse;
use App\Core\Http\ErrorCode;
use App\Core\Http\ListQuery;
use App\Modules\Workflow\Contracts\ApprovalEngine;
use App\Modules\Workflow\Http\Requests\DecisionRequest;
use App\Modules\Workflow\Http\Resources\ApprovalRequestResource;
use App\Modules\Workflow\Models\ApprovalRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

final class ApprovalController
{
    public function __construct(private readonly ApprovalEngine $engine) {}

    public function pending(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', ApprovalRequest::class);
        $user = $request->user() ?? throw new ApiException(ErrorCode::Unauthenticated);

        return ApiResponse::paginated(ListQuery::for(
            $this->engine->pendingFor($user)->with('decisions'), $request,
            ['created_at', 'document_type', 'amount'], ['document_type'], ['document_type'],
        ), ApprovalRequestResource::class);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $approval = ApprovalRequest::query()->findOrFail($id);
        Gate::authorize('view', $approval);

        return ApiResponse::success((new ApprovalRequestResource($approval->load('decisions')))->resolve($request));
    }

    public function decide(DecisionRequest $request, string $id): JsonResponse
    {
        $approval = ApprovalRequest::query()->findOrFail($id);
        Gate::authorize('decide', $approval);
        if ($request->has('version')) {
            $approval->assertVersion($request->integer('version'));
        }
        $user = $request->user() ?? throw new ApiException(ErrorCode::Unauthenticated);
        $comment = $request->input('comment');
        $approval = $this->engine->decide(
            $approval, $user, $request->string('decision')->toString(), is_string($comment) ? $comment : null,
        );

        return ApiResponse::success((new ApprovalRequestResource($approval->load('decisions')))->resolve($request));
    }
}
