<?php

declare(strict_types=1);

namespace Tests\Support\Svc;

use App\Core\Company\CompanyContext;
use App\Core\Company\MembershipChecker;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

/**
 * Test-only stand-in for identity: users and companies are plain uuids, permissions are
 * an attribute on the user. Delete this file once the identity module ships its factories.
 */
final class SvcActors
{
    /** @var list<string> */
    public const array PERMISSIONS = [
        'settings.view', 'settings.update', 'files.view', 'files.create', 'files.delete', 'accounting.settings.update',
    ];

    public static function company(): string
    {
        return (string) Str::uuid7();
    }

    /**
     * @param  list<string>  $permissions
     */
    public static function user(array $permissions = []): SvcUser
    {
        return new SvcUser(['id' => (string) Str::uuid7(), 'permissions' => $permissions]);
    }

    /**
     * Everyone is a member of every company; abilities follow the user's permission list.
     */
    public static function install(): void
    {
        app()->instance(MembershipChecker::class, new class implements MembershipChecker
        {
            public function isMember(string $userId, string $companyId): bool
            {
                return true;
            }
        });

        foreach (self::PERMISSIONS as $permission) {
            Gate::define($permission, static function (SvcUser $user) use ($permission): bool {
                /** @var list<string> $granted */
                $granted = $user->permissions;

                return in_array($permission, $granted, true);
            });
        }
    }

    public static function activate(string $companyId): void
    {
        app(CompanyContext::class)->set($companyId);
    }
}
