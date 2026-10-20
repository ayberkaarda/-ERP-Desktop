<?php

declare(strict_types=1);

namespace App\Modules\Identity\Services;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Modules\Identity\Contracts\CompanyAuthorizer;
use App\Modules\Identity\Models\Permission;
use App\Modules\Identity\Models\Role;

/**
 * Roles of the active company. The system Admin role keeps its name and full catalog so a
 * company can never lock itself out.
 */
final class RoleAdministration
{
    public function __construct(private readonly CompanyAuthorizer $authorizer) {}

    /**
     * @param  array{name: string, description?: string|null, permissions?: list<string>}  $data
     */
    public function create(array $data): Role
    {
        $role = new Role([
            'name' => $data['name'],
            'guard_name' => PermissionCatalog::GUARD,
            'description' => $data['description'] ?? null,
            'is_system' => false,
        ]);
        $role->save();

        $this->syncPermissions($role, $data['permissions'] ?? []);

        return $role;
    }

    /**
     * @param  array{name?: string, description?: string|null, permissions?: list<string>}  $data
     */
    public function update(Role $role, array $data): Role
    {
        $isAdmin = $role->is_system && $role->name === Role::ADMIN;

        if ($isAdmin && ((isset($data['name']) && $data['name'] !== $role->name) || isset($data['permissions']))) {
            throw new ApiException(ErrorCode::Forbidden, __('identity::roles.admin_locked'));
        }

        $role->fill(array_intersect_key($data, array_flip(['name', 'description'])))->save();

        if (array_key_exists('permissions', $data)) {
            $this->syncPermissions($role, $data['permissions']);
        }

        return $role;
    }

    public function delete(Role $role): void
    {
        if ($role->is_system && $role->name === Role::ADMIN) {
            throw new ApiException(ErrorCode::Forbidden, __('identity::roles.admin_locked'));
        }

        $role->delete();
        $this->authorizer->forget();
    }

    /**
     * @param  list<string>  $names
     */
    private function syncPermissions(Role $role, array $names): void
    {
        $before = $role->permissions()->pluck('name')->sort()->values()->all();
        $permissions = Permission::query()->whereIn('name', $names)->where('guard_name', PermissionCatalog::GUARD)->get();

        $role->syncPermissions($permissions->all());
        $role->unsetRelation('permissions');

        $after = $permissions->pluck('name')->sort()->values()->all();

        if ($before !== $after) {
            activity()
                ->performedOn($role)
                ->event('permissions_synced')
                ->withChanges(['old' => ['permissions' => $before], 'attributes' => ['permissions' => $after]])
                ->log('permissions_synced');
        }

        $this->authorizer->forget();
    }
}
