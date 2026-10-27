<?php

declare(strict_types=1);

namespace App\Modules\Identity\Services;

use App\Core\Company\CompanyContext;
use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Models\User;
use App\Modules\Identity\Contracts\CompanyAuthorizer;
use App\Modules\Identity\Events\AccessChanged;
use App\Modules\Identity\Events\MembershipRevoked;
use App\Modules\Identity\Models\Role;
use App\Modules\Organization\Contracts\CompanyDirectory;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Admin-side user lifecycle. Invariants here hold for super admins too (the gate bypass does
 * not reach them): nobody deactivates, deletes or resets themselves, and the last active
 * super admin cannot be removed or demoted.
 *
 * Role assignment and the super admin flag change what the user may do: both run in one
 * transaction and dispatch AccessChanged inside it. Deactivation and deletion revoke every token
 * instead, so no sync request of the user gets through afterwards.
 */
final class UserAdministration
{
    public function __construct(
        private readonly CompanyDirectory $companies,
        private readonly CompanyContext $context,
        private readonly CompanyAuthorizer $authorizer,
        private readonly AccessRevoker $revoker,
    ) {}

    /**
     * @param  array{name: string, email: string, password: string, locale?: string, roles?: list<string>}  $data
     */
    public function create(?User $actor, array $data, string $companyId): User
    {
        $user = new User;
        $user->fill([
            'name' => $data['name'],
            'email' => $data['email'],
            'password' => $data['password'],
            'locale' => $data['locale'] ?? 'tr',
        ]);
        // Admin-chosen initial passwords are temporary.
        $user->forceFill(['must_change_password' => true])->save();

        $this->companies->setMembership($user->id, $companyId, true);

        if (($data['roles'] ?? []) !== []) {
            $this->syncRoles($actor, $user, $companyId, $data['roles']);
        }

        return $user;
    }

    /**
     * @param  array{name?: string, email?: string, locale?: string, is_super_admin?: bool}  $data
     */
    public function update(User $actor, User $target, array $data): User
    {
        if (array_key_exists('is_super_admin', $data)) {
            if (! $actor->is_super_admin) {
                throw new ApiException(ErrorCode::Forbidden);
            }

            if (! $data['is_super_admin'] && $target->is_super_admin) {
                $this->guardLastSuperAdmin($target);
            }

            $target->forceFill(['is_super_admin' => $data['is_super_admin']]);
        }

        return DB::transaction(function () use ($target, $data): User {
            // The super admin flag grants every permission in every company.
            $flagChanged = $target->isDirty('is_super_admin');
            $target->fill(array_intersect_key($data, array_flip(['name', 'email', 'locale'])))->save();
            $this->authorizer->forget($target->id);

            if ($flagChanged) {
                AccessChanged::dispatch([$target->id], null);
            }

            return $target;
        });
    }

    public function setStatus(User $actor, User $target, bool $active): User
    {
        if ($active === $target->is_active) {
            return $target;
        }

        if (! $active) {
            $this->guardSelf($actor, $target);
            $this->guardLastSuperAdmin($target);

            $target->forceFill(['is_active' => false, 'deactivated_at' => Carbon::now()])->save();
            $this->revoker->revokeAll($target, 'deactivated');
        } else {
            $target->forceFill(['is_active' => true, 'deactivated_at' => null])->save();
        }

        $this->authorizer->forget($target->id);

        return $target;
    }

    public function resetPassword(User $actor, User $target, string $password): void
    {
        $this->guardSelf($actor, $target);

        $target->forceFill([
            'password' => $password,
            'must_change_password' => true,
            'password_changed_at' => Carbon::now(),
        ])->save();
        $target->bumpAuthVersion();

        $this->revoker->revokeAll($target, 'password_reset');
    }

    public function delete(User $actor, User $target): void
    {
        $this->guardSelf($actor, $target);
        $this->guardLastSuperAdmin($target);

        $this->revoker->revokeAll($target, 'deleted');
        $target->delete();
        $this->authorizer->forget($target->id);
    }

    /**
     * Replaces the user's roles in one company. A non-empty list (re)activates the membership;
     * an empty list removes all roles and deactivates the membership.
     *
     * @param  list<string>  $roles  role ids or names
     * @return list<string> role names now held
     */
    public function syncRoles(?User $actor, User $target, string $companyId, array $roles): array
    {
        if (! $this->companies->isActive($companyId)) {
            throw new ApiException(ErrorCode::NotFound);
        }

        // One transaction: roles, membership and the AccessChanged listeners commit together.
        return DB::transaction(fn (): array => $this->context->runAs($companyId, function () use ($actor, $target, $companyId, $roles): array {
            $ids = array_values(array_filter($roles, Str::isUuid(...)));
            $names = array_values(array_diff($roles, $ids));

            $found = $roles === [] ? collect() : Role::query()
                ->where('guard_name', PermissionCatalog::GUARD)
                ->where(fn ($q) => $q->whereIn('id', $ids)->orWhereIn('name', $names))
                ->get();

            if ($found->count() !== count($roles)) {
                throw new ApiException(ErrorCode::ValidationError, fields: [
                    'roles' => [__('identity::users.unknown_roles')],
                ]);
            }

            $target->unsetRelation('roles');
            $current = Role::query()->whereIn('id', $target->roles()->pluck('roles.id'))->get();
            $before = $current->pluck('name')->sort()->values()->all();

            if ($actor !== null) {
                $this->guardRoleChange($actor, $target, $companyId, $current->all(), $found->all());
            }

            $target->syncRoles($found->all());
            $target->unsetRelation('roles');
            $this->companies->setMembership($target->id, $companyId, $found->isNotEmpty());

            if ($found->isEmpty() && $current->isNotEmpty()) {
                MembershipRevoked::dispatch($target->id, $companyId);
            }

            $after = array_map(static fn (Role $role): string => $role->name, $found->all());
            sort($after);

            if ($before !== $after) {
                activity()
                    ->performedOn($target)
                    ->event('roles_synced')
                    ->withChanges(['old' => ['roles' => $before], 'attributes' => ['roles' => $after]])
                    ->log('roles_synced');
            }

            $this->authorizer->forget($target->id);

            $ids = static fn (iterable $roles): array => collect($roles)->map(static fn (Role $role): string => $role->id)->sort()->values()->all();

            if ($ids($current) !== $ids($found)) {
                AccessChanged::dispatch([$target->id], $companyId);
            }

            return $after;
        }));
    }

    /**
     * Role changes may only move permissions the actor holds in that company; the system Admin
     * role is reserved to its holders; nobody edits their own roles. Super admins are exempt
     * from the delegation rules, not from the own-roles rule.
     *
     * @param  array<int, Role>  $current
     * @param  array<int, Role>  $next
     */
    private function guardRoleChange(User $actor, User $target, string $companyId, array $current, array $next): void
    {
        if ($actor->id === $target->id) {
            throw new ApiException(ErrorCode::Forbidden, __('identity::users.not_own_roles'));
        }

        if ($actor->is_super_admin) {
            return;
        }

        $currentIds = array_map(static fn (Role $r): string => $r->id, $current);
        $nextIds = array_map(static fn (Role $r): string => $r->id, $next);
        $changed = array_merge(
            array_filter($next, static fn (Role $r): bool => ! in_array($r->id, $currentIds, true)),
            array_filter($current, static fn (Role $r): bool => ! in_array($r->id, $nextIds, true)),
        );

        $held = $this->authorizer->permissionsByCompany($actor)[$companyId] ?? [];
        $actorRoles = $this->authorizer->roleNamesByCompany($actor)[$companyId] ?? [];

        foreach ($changed as $role) {
            if ($role->is_system && $role->name === Role::ADMIN && ! in_array(Role::ADMIN, $actorRoles, true)) {
                throw new ApiException(ErrorCode::Forbidden, __('identity::users.role_not_delegable'));
            }

            $permissions = $role->permissions()->pluck('name')->all();

            if (array_diff($permissions, $held) !== []) {
                throw new ApiException(ErrorCode::Forbidden, __('identity::users.role_not_delegable'));
            }
        }
    }

    private function guardSelf(User $actor, User $target): void
    {
        if ($actor->id === $target->id) {
            throw new ApiException(ErrorCode::Forbidden, __('identity::users.not_on_self'));
        }
    }

    private function guardLastSuperAdmin(User $target): void
    {
        if (! $target->is_super_admin) {
            return;
        }

        $others = User::query()->where('is_super_admin', true)->where('is_active', true)->whereKeyNot($target->id)->exists();

        if (! $others) {
            throw new ApiException(ErrorCode::Forbidden, __('identity::users.last_super_admin'));
        }
    }
}
