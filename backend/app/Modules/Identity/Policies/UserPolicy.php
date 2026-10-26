<?php

declare(strict_types=1);

namespace App\Modules\Identity\Policies;

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Identity\Contracts\CompanyAuthorizer;
use App\Modules\Organization\Contracts\CompanyDirectory;

/**
 * Account-level changes (profile, status, password, delete) affect every company the target
 * belongs to, so the actor needs the permission in all of them, not only in the active one.
 * Super admins pass through Gate::before; nobody else may touch a super admin.
 */
final class UserPolicy
{
    use ChecksCompanyPermission;

    public function __construct(
        private readonly CompanyContext $context,
        private readonly CompanyAuthorizer $authorizer,
        private readonly CompanyDirectory $companies,
    ) {}

    public function viewAny(User $user): bool
    {
        return $this->allowedInActiveCompany($user, 'users.view');
    }

    public function view(User $user, User $target): bool
    {
        $company = $this->context->idOrNull();

        return $company !== null
            && $this->allowedInActiveCompany($user, 'users.view')
            && $this->companies->hasMembership($target->id, $company);
    }

    public function create(User $user): bool
    {
        return $this->allowedInActiveCompany($user, 'users.create');
    }

    public function update(User $user, User $target): bool
    {
        return $this->manages($user, $target, 'users.update');
    }

    public function updateStatus(User $user, User $target): bool
    {
        return $this->manages($user, $target, 'users.status');
    }

    public function resetPassword(User $user, User $target): bool
    {
        return $this->manages($user, $target, 'users.reset_password');
    }

    public function delete(User $user, User $target): bool
    {
        return $this->manages($user, $target, 'users.delete');
    }

    public function assignRoles(User $user, User $target, string $companyId): bool
    {
        // Only users already in the company; pulling outsiders in is a super admin action.
        return ! $target->is_super_admin
            && $this->authorizer->allows($user, 'roles.assign', $companyId)
            && (! $target->exists || $this->companies->hasMembership($target->id, $companyId));
    }

    private function manages(User $actor, User $target, string $permission): bool
    {
        $company = $this->context->idOrNull();

        if ($company === null || $target->is_super_admin || ! $this->companies->hasMembership($target->id, $company)) {
            return false;
        }

        foreach ([$company, ...$this->companies->membershipCompanyIds($target->id)] as $companyId) {
            if (! $this->authorizer->allows($actor, $permission, $companyId)) {
                return false;
            }
        }

        return true;
    }
}
