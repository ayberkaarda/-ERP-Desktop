<?php

declare(strict_types=1);

namespace App\Modules\Organization\Http\Controllers;

use App\Core\Company\CompanyContext;
use App\Core\Http\ApiException;
use App\Core\Http\ApiResponse;
use App\Core\Http\ErrorCode;
use App\Core\Http\ListQuery;
use App\Modules\Organization\Http\Requests\BranchRequest;
use App\Modules\Organization\Http\Resources\BranchResource;
use App\Modules\Organization\Models\Branch;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * /companies/{company}/branches: the path company must be the active (header) company.
 */
final class BranchController
{
    public function __construct(private readonly CompanyContext $context) {}

    public function index(Request $request, string $company): JsonResponse
    {
        $this->samePath($company);
        Gate::authorize('viewAny', Branch::class);

        return ApiResponse::paginated(
            ListQuery::for(Branch::query(), $request, ['code', 'name', 'created_at'], ['is_active'], ['code', 'name']),
            BranchResource::class,
        );
    }

    public function store(BranchRequest $request, string $company): JsonResponse
    {
        $this->samePath($company);
        Gate::authorize('create', Branch::class);

        $branch = Branch::query()->create($request->validated());

        return ApiResponse::created((new BranchResource($branch))->resolve($request));
    }

    public function show(Request $request, string $company, Branch $branch): JsonResponse
    {
        $this->samePath($company);
        Gate::authorize('view', $branch);

        return ApiResponse::success((new BranchResource($branch))->resolve($request));
    }

    public function update(BranchRequest $request, string $company, Branch $branch): JsonResponse
    {
        $this->samePath($company);
        Gate::authorize('update', $branch);

        $branch->fill($request->validated())->save();

        return ApiResponse::success((new BranchResource($branch))->resolve($request));
    }

    public function destroy(string $company, Branch $branch): JsonResponse
    {
        $this->samePath($company);
        Gate::authorize('delete', $branch);

        $branch->delete();

        return ApiResponse::noContent();
    }

    private function samePath(string $company): void
    {
        if ($company !== $this->context->id()) {
            throw new ApiException(ErrorCode::NotFound);
        }
    }
}
