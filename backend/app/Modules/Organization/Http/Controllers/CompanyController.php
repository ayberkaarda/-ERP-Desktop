<?php

declare(strict_types=1);

namespace App\Modules\Organization\Http\Controllers;

use App\Core\Http\ApiException;
use App\Core\Http\ApiResponse;
use App\Core\Http\ErrorCode;
use App\Core\Http\ListQuery;
use App\Models\User;
use App\Modules\Organization\Contracts\CompanyDirectory;
use App\Modules\Organization\Events\CompanyCreated;
use App\Modules\Organization\Http\Requests\CompanyRequest;
use App\Modules\Organization\Http\Resources\CompanyResource;
use App\Modules\Organization\Models\Company;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Companies are addressed by id, not by the X-Company-Id header. Non-members get 404.
 */
final class CompanyController
{
    public function __construct(private readonly CompanyDirectory $companies) {}

    public function index(Request $request): JsonResponse
    {
        $user = $this->user($request);
        Gate::authorize('viewAny', Company::class);

        $query = Company::query();

        if (! $user->is_super_admin) {
            $query->whereIn('id', array_column($this->companies->companiesFor($user->id), 'id'));
        }

        return ApiResponse::paginated(
            ListQuery::for($query, $request, ['name', 'code', 'created_at'], ['is_active', 'country_code'], ['name', 'code', 'legal_name']),
            CompanyResource::class,
        );
    }

    public function store(CompanyRequest $request): JsonResponse
    {
        Gate::authorize('create', Company::class);

        // The company, its default roles and its master data defaults commit together or not at all.
        $company = DB::transaction(function () use ($request): Company {
            $company = Company::query()->create($request->validated());
            CompanyCreated::dispatch($company->id, $this->user($request)->id);

            return $company;
        });

        return ApiResponse::created((new CompanyResource($company))->resolve($request));
    }

    public function show(Request $request, Company $company): JsonResponse
    {
        $this->visible($request, $company);
        Gate::authorize('view', $company);

        return ApiResponse::success((new CompanyResource($company))->resolve($request));
    }

    public function update(CompanyRequest $request, Company $company): JsonResponse
    {
        $this->visible($request, $company);
        Gate::authorize('update', $company);

        $company->fill($request->validated())->save();

        return ApiResponse::success((new CompanyResource($company))->resolve($request));
    }

    public function destroy(Request $request, Company $company): JsonResponse
    {
        $this->visible($request, $company);
        Gate::authorize('delete', $company);

        $company->delete();

        return ApiResponse::noContent();
    }

    private function visible(Request $request, Company $company): void
    {
        $user = $this->user($request);

        if (! $user->is_super_admin && ! $this->companies->isActiveMember($user->id, $company->id)) {
            throw new ApiException(ErrorCode::NotFound);
        }
    }

    private function user(Request $request): User
    {
        $user = $request->user();

        if (! $user instanceof User) {
            throw new ApiException(ErrorCode::Unauthenticated);
        }

        return $user;
    }
}
