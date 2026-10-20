<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Identity\Contracts\CompanyAuthorizer;
use App\Modules\Identity\Contracts\PermissionRegistry;
use App\Modules\Identity\Models\Permission;
use App\Modules\Identity\Models\Role;
use App\Modules\Identity\Services\PermissionCatalog;
use App\Modules\Organization\Contracts\CompanyDirectory;

/**
 * Real users, companies, memberships and roles for module tests: a user gets exactly the
 * permissions a test names, through a role in the given company.
 */
final class Actors
{
    private static ?string $current = null;

    /**
     * A new company with default roles; later users() join it unless told otherwise.
     */
    public static function company(): string
    {
        Identity::boot();

        return self::$current = Identity::company()->id;
    }

    /**
     * Another company the user also belongs to (with these permissions); the current company stays.
     *
     * @param  list<string>  $permissions
     */
    public static function companyFor(User $user, array $permissions = []): string
    {
        $company = Identity::company()->id;
        self::grant($user, $company, $permissions);

        return $company;
    }

    /**
     * @param  list<string>  $permissions
     * @param  array<string, mixed>  $attributes
     */
    public static function user(array $permissions = [], ?string $company = null, array $attributes = []): User
    {
        $user = User::factory()->create(['password' => Identity::PASSWORD, ...$attributes]);
        $company ??= self::$current;

        if ($company !== null) {
            self::grant($user, $company, $permissions);
        }

        return $user;
    }

    /**
     * Active membership in the company plus a role holding exactly these permissions (none: membership only).
     *
     * @param  list<string>  $permissions
     */
    public static function grant(User $user, string $company, array $permissions): void
    {
        app(CompanyDirectory::class)->setMembership($user->id, $company, true);

        if ($permissions !== []) {
            $role = self::role($company, $permissions);
            app(CompanyContext::class)->runAs($company, function () use ($user, $role): void {
                $user->unsetRelation('roles');
                $user->assignRole($role);
                $user->unsetRelation('roles');
            });
        }

        app(CompanyAuthorizer::class)->forget($user->id);
    }

    /**
     * Takes every role in the company away; the membership stays.
     */
    public static function revoke(User $user, string $company): void
    {
        app(CompanyContext::class)->runAs($company, function () use ($user): void {
            $user->unsetRelation('roles');
            $user->syncRoles([]);
            $user->unsetRelation('roles');
        });
        app(CompanyAuthorizer::class)->forget($user->id);
    }

    public static function activate(string $company): void
    {
        app(CompanyContext::class)->set($company);
    }

    /**
     * Unknown names (module-specific test permissions) are added to the catalog first.
     *
     * @param  list<string>  $permissions
     */
    private static function role(string $company, array $permissions): Role
    {
        $catalog = app(PermissionRegistry::class);
        $unknown = array_values(array_diff($permissions, $catalog->all()));

        if ($unknown !== []) {
            $catalog->register('tests', $unknown);
            app(PermissionCatalog::class)->sync();
        }

        sort($permissions);
        $name = 'Test '.substr(hash('sha256', implode(',', $permissions)), 0, 12);

        return app(CompanyContext::class)->runAs($company, static function () use ($name, $permissions): Role {
            $role = Role::query()->where('name', $name)->first();

            if (! $role instanceof Role) {
                $role = new Role(['name' => $name, 'guard_name' => PermissionCatalog::GUARD]);
                $role->save();
                $role->syncPermissions(Permission::query()->whereIn('name', $permissions)->get()->all());
            }

            return $role;
        });
    }
}
