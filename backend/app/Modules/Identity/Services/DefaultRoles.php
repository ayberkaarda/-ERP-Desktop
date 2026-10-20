<?php

declare(strict_types=1);

namespace App\Modules\Identity\Services;

use App\Core\Company\CompanyContext;
use App\Modules\Identity\Models\Permission;
use App\Modules\Identity\Models\Role;
use Spatie\Permission\PermissionRegistrar;

/**
 * Standard roles every company starts with. Admin always holds the full catalog
 * (except deleting the company itself); the others get a fixed baseline that admins may edit.
 */
final class DefaultRoles
{
    private const array BASELINE = [
        'companies.view', 'branches.view', 'departments.view', 'notifications.view', 'files.view', 'files.create',
    ];

    /** @var array<string, list<string>> */
    private const array ROLES = [
        'Accountant' => ['settings.view', 'users.view'],
        'Sales' => [],
        'Purchasing' => [],
        'Warehouse' => [],
        'HR' => ['users.view', 'users.create', 'users.update', 'departments.create', 'departments.update'],
        'Viewer' => [],
    ];

    /** Never granted by default, even to Admin. */
    private const array ADMIN_EXCLUDED = PermissionCatalog::SUPER_ADMIN_ONLY;

    public function __construct(
        private readonly PermissionCatalog $catalog,
        private readonly CompanyContext $context,
        private readonly PermissionRegistrar $registrar,
    ) {}

    /**
     * Creates missing default roles in the company and tops Admin up to the full catalog. Idempotent.
     */
    public function ensureFor(string $companyId): void
    {
        $this->catalog->sync();

        $this->context->runAs($companyId, function (): void {
            $admin = $this->role(Role::ADMIN);
            $admin->givePermissionTo($this->permissions(array_values(array_diff($this->catalog->all(), self::ADMIN_EXCLUDED))));

            foreach (self::ROLES as $name => $extra) {
                $role = $this->role($name);

                if ($role->wasRecentlyCreated) {
                    $role->givePermissionTo($this->permissions([...self::BASELINE, ...$extra]));
                }
            }
        });

        $this->registrar->forgetCachedPermissions();
    }

    /**
     * @return list<string>
     */
    public static function names(): array
    {
        return [Role::ADMIN, ...array_keys(self::ROLES)];
    }

    private function role(string $name): Role
    {
        $role = Role::query()->where('name', $name)->where('guard_name', PermissionCatalog::GUARD)->first();

        if ($role instanceof Role) {
            return $role;
        }

        $role = new Role(['name' => $name, 'guard_name' => PermissionCatalog::GUARD, 'is_system' => true]);
        $role->save();

        return $role;
    }

    /**
     * Only names that exist in the catalog, so a renamed permission never breaks company creation.
     *
     * @param  list<string>  $names
     * @return list<Permission>
     */
    private function permissions(array $names): array
    {
        return array_values(Permission::query()->whereIn('name', array_unique($names))->where('guard_name', PermissionCatalog::GUARD)->get()->all());
    }
}
