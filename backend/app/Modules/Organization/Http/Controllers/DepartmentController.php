<?php

declare(strict_types=1);

namespace App\Modules\Organization\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Core\Http\ListQuery;
use App\Modules\Organization\Http\Requests\DepartmentRequest;
use App\Modules\Organization\Http\Resources\DepartmentResource;
use App\Modules\Organization\Models\Department;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

final class DepartmentController
{
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', Department::class);

        return ApiResponse::paginated(
            ListQuery::for(Department::query(), $request, ['code', 'name', 'created_at'], ['is_active', 'branch_id', 'parent_id'], ['code', 'name']),
            DepartmentResource::class,
        );
    }

    public function store(DepartmentRequest $request): JsonResponse
    {
        Gate::authorize('create', Department::class);

        $department = Department::query()->create($request->validated());

        return ApiResponse::created((new DepartmentResource($department))->resolve($request));
    }

    public function show(Request $request, Department $department): JsonResponse
    {
        Gate::authorize('view', $department);

        return ApiResponse::success((new DepartmentResource($department))->resolve($request));
    }

    public function update(DepartmentRequest $request, Department $department): JsonResponse
    {
        Gate::authorize('update', $department);

        $department->fill($request->validated())->save();

        return ApiResponse::success((new DepartmentResource($department))->resolve($request));
    }

    public function destroy(Department $department): JsonResponse
    {
        Gate::authorize('delete', $department);

        $department->delete();

        return ApiResponse::noContent();
    }
}
