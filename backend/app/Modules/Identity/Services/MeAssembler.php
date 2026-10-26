<?php

declare(strict_types=1);

namespace App\Modules\Identity\Services;

use App\Models\User;
use App\Modules\Identity\Http\Resources\AuthUserResource;
use App\Modules\Organization\Contracts\CompanyDirectory;
use Illuminate\Http\Request;
use stdClass;

/**
 * Builds the GET /auth/me payload.
 */
final class MeAssembler
{
    public function __construct(
        private readonly CompanyDirectory $companies,
        private readonly PermissionResolver $permissions,
    ) {}

    /**
     * @return array{user: array<string, mixed>, companies: list<array{id: string, name: string, role_names: list<string>}>, permissions: array<string, list<string>>|stdClass}
     */
    public function for(User $user, Request $request): array
    {
        $companies = $user->is_super_admin ? $this->companies->allActiveCompanies() : $this->companies->companiesFor($user->id);
        $roles = $this->permissions->roleNamesByCompany($user);
        $permissions = $this->permissions->permissionsByCompany($user);

        return [
            'user' => (new AuthUserResource($user))->resolve($request),
            'companies' => array_map(static fn (array $c): array => [
                'id' => $c['id'],
                'name' => $c['name'],
                'role_names' => $roles[$c['id']] ?? [],
            ], $companies),
            // Keep an object in JSON even when empty.
            'permissions' => $permissions === [] ? new stdClass : $permissions,
        ];
    }
}
