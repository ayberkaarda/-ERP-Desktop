<?php

declare(strict_types=1);

namespace App\Modules\Identity\Services;

use App\Core\Company\CompanyContext;
use App\Modules\Identity\Models\Permission;
use App\Modules\Identity\Models\Role;
use Spatie\Permission\PermissionRegistrar;

/**
 * Standard roles every company starts with. Admin always holds the full catalog
 * (except super-admin-only ones); the others get the baseline the modules declare, which admins may edit.
 */
final class DefaultRoles
{
    /** Non-Admin default roles; what each holds is declared by the modules permissions.php files. */
    private const array ROLES = ['Accountant', 'Sales', 'Purchasing', 'Warehouse', 'HR', 'Viewer'];

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
            $admin->givePermissionTo($this->permissions(array_values(array_diff($this->catalog->all(), $this->catalog->superAdminOnly()))));

            foreach (self::ROLES as $name) {
                $role = $this->role($name);

                if ($role->wasRecentlyCreated) {
                    $role->givePermissionTo($this->permissions($this->catalog->grantsFor($name)));
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
        return [Role::ADMIN, ...self::ROLES];
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
