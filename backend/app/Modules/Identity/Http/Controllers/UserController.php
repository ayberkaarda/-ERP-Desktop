<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http\Controllers;

use App\Core\Company\CompanyContext;
use App\Core\Http\ApiResponse;
use App\Core\Http\ListQuery;
use App\Models\User;
use App\Modules\Identity\Http\Requests\AdminPasswordResetRequest;
use App\Modules\Identity\Http\Requests\AssignRolesRequest;
use App\Modules\Identity\Http\Requests\StoreUserRequest;
use App\Modules\Identity\Http\Requests\UpdateUserRequest;
use App\Modules\Identity\Http\Requests\UserStatusRequest;
use App\Modules\Identity\Http\Resources\UserResource;
use App\Modules\Identity\Rules\StrongPassword;
use App\Modules\Identity\Services\UserAdministration;
use App\Modules\Organization\Contracts\CompanyDirectory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;

/**
 * Users of the active company. Lookups are constrained to its members, so ids from other
 * companies answer 404 before any policy runs.
 */
final class UserController
{
    use CurrentUser;

    // Request-scoped services are resolved per call: the router reuses controller instances.
    public function __construct(private readonly CompanyDirectory $companies) {}

    private function companyId(): string
    {
        return app(CompanyContext::class)->id();
    }

    private function users(): UserAdministration
    {
        return app(UserAdministration::class);
    }

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', User::class);

        $query = $this->members()->with('roles');

        return ApiResponse::paginated(
            ListQuery::for($query, $request, ['name', 'email', 'created_at', 'last_login_at'], ['is_active', 'locale'], ['name', 'email']),
            UserResource::class,
        );
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $user = $this->member($id);
        Gate::authorize('view', $user);

        return $this->single($user, $request);
    }

    public function store(StoreUserRequest $request): JsonResponse
    {
        Gate::authorize('create', User::class);

        /** @var array{name: string, email: string, password: string, locale?: string, roles?: list<string>} $data */
        $data = $request->validated();

        if (($data['roles'] ?? []) !== []) {
            Gate::authorize('assignRoles', [new User, $this->companyId()]);
        }

        $user = $this->users()->create($data, $this->companyId());

        return ApiResponse::created((new UserResource($user->load('roles')))->resolve($request));
    }

    public function update(UpdateUserRequest $request, string $id): JsonResponse
    {
        $user = $this->member($id);
        Gate::authorize('update', $user);

        /** @var array{name?: string, email?: string, locale?: string, is_super_admin?: bool} $data */
        $data = $request->validated();
        $this->users()->update($this->currentUser($request), $user, $data);

        return $this->single($user, $request);
    }

    public function status(UserStatusRequest $request, string $id): JsonResponse
    {
        $user = $this->member($id);
        Gate::authorize('updateStatus', $user);

        $this->users()->setStatus($this->currentUser($request), $user, $request->boolean('is_active'));

        return $this->single($user, $request);
    }

    public function resetPassword(AdminPasswordResetRequest $request, string $id): JsonResponse
    {
        $user = $this->member($id);
        Gate::authorize('resetPassword', $user);

        $password = Validator::make($request->only('password'), [
            'password' => [new StrongPassword($user->email, $user->name)],
        ])->validate();

        $this->users()->resetPassword($this->currentUser($request), $user, (string) $password['password']);

        return ApiResponse::noContent();
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $user = $this->member($id);
        Gate::authorize('delete', $user);

        $this->users()->delete($this->currentUser($request), $user);

        return ApiResponse::noContent();
    }

    /**
     * PUT /users/{id}/roles {company_id, roles}: not tied to the X-Company-Id header; the
     * actor needs roles.assign in the named company.
     */
    public function roles(AssignRolesRequest $request, string $id): JsonResponse
    {
        $user = User::query()->findOrFail($id);
        $companyId = $request->string('company_id')->toString();
        Gate::authorize('assignRoles', [$user, $companyId]);

        /** @var list<string> $roles */
        $roles = $request->validated('roles');
        $names = $this->users()->syncRoles($user, $companyId, $roles);

        return ApiResponse::success(['company_id' => $companyId, 'roles' => $names]);
    }

    /**
     * @return Builder<User>
     */
    private function members(): Builder
    {
        $query = User::query();
        $this->companies->constrainToMembers($query, $this->companyId(), 'id');

        return $query;
    }

    private function member(string $id): User
    {
        return $this->members()->findOrFail($id);
    }

    private function single(User $user, Request $request): JsonResponse
    {
        $user->unsetRelation('roles');

        return ApiResponse::success((new UserResource($user->load('roles')))->resolve($request));
    }
}
