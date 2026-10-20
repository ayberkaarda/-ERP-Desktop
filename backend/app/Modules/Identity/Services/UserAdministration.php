<?php

declare(strict_types=1);

namespace App\Modules\Identity\Services;

use App\Core\Company\CompanyContext;
use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Models\User;
use App\Modules\Identity\Contracts\CompanyAuthorizer;
use App\Modules\Identity\Models\Role;
use App\Modules\Organization\Contracts\CompanyDirectory;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * Admin-side user lifecycle. Invariants here hold for super admins too (the gate bypass does
 * not reach them): nobody deactivates, deletes or resets themselves, and the last active
 * super admin cannot be removed or demoted.
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
    public function create(array $data, string $companyId): User
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
            $this->syncRoles($user, $companyId, $data['roles']);
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

        $target->fill(array_intersect_key($data, array_flip(['name', 'email', 'locale'])))->save();
        $this->authorizer->forget($target->id);

        return $target;
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
    public function syncRoles(User $target, string $companyId, array $roles): array
    {
        if (! $this->companies->isActive($companyId)) {
            throw new ApiException(ErrorCode::NotFound);
        }

        return $this->context->runAs($companyId, function () use ($target, $companyId, $roles): array {
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
            $before = $target->roles()->pluck('name')->sort()->values()->all();

            $target->syncRoles($found->all());
            $target->unsetRelation('roles');
            $this->companies->setMembership($target->id, $companyId, $found->isNotEmpty());

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

            return $after;
        });
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
