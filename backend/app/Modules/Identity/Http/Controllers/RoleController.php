<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Core\Http\ListQuery;
use App\Modules\Identity\Http\Requests\RoleRequest;
use App\Modules\Identity\Http\Resources\RoleResource;
use App\Modules\Identity\Models\Role;
use App\Modules\Identity\Services\RoleAdministration;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * Roles of the active company; route binding is company scoped by BelongsToCompany.
 */
final class RoleController
{
    // Resolved per call: the router reuses controller instances and the service holds request state.
    private function roles(): RoleAdministration
    {
        return app(RoleAdministration::class);
    }

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', Role::class);

        return ApiResponse::paginated(
            ListQuery::for(Role::query()->with('permissions'), $request, ['name', 'created_at'], ['is_system'], ['name']),
            RoleResource::class,
        );
    }

    public function show(Request $request, Role $role): JsonResponse
    {
        Gate::authorize('view', $role);

        return ApiResponse::success((new RoleResource($role->load('permissions')))->resolve($request));
    }

    public function store(RoleRequest $request): JsonResponse
    {
        Gate::authorize('create', Role::class);

        /** @var array{name: string, description?: string|null, permissions?: list<string>} $data */
        $data = $request->validated();
        $role = $this->roles()->create($data);

        return ApiResponse::created((new RoleResource($role->load('permissions')))->resolve($request));
    }

    public function update(RoleRequest $request, Role $role): JsonResponse
    {
        Gate::authorize('update', $role);

        /** @var array{name?: string, description?: string|null, permissions?: list<string>} $data */
        $data = $request->validated();
        $this->roles()->update($role, $data);

        return ApiResponse::success((new RoleResource($role->load('permissions')))->resolve($request));
    }

    public function destroy(Role $role): JsonResponse
    {
        Gate::authorize('delete', $role);

        $this->roles()->delete($role);

        return ApiResponse::noContent();
    }
}
