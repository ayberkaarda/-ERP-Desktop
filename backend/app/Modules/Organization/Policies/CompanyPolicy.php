<?php

declare(strict_types=1);

namespace App\Modules\Organization\Policies;

use App\Models\User;
use App\Modules\Identity\Contracts\CompanyAuthorizer;
use App\Modules\Organization\Models\Company;

/**
 * Company records are checked against the permission inside that company, not the header company.
 * Creating companies is reserved for super admins (Gate::before).
 */
final class CompanyPolicy
{
    public function __construct(private readonly CompanyAuthorizer $authorizer) {}

    public function viewAny(User $user): bool
    {
        return true;
    }

    public function view(User $user, Company $company): bool
    {
        return $this->authorizer->allows($user, 'companies.view', $company->id);
    }

    public function create(User $user): bool
    {
        return false;
    }

    public function update(User $user, Company $company): bool
    {
        return $this->authorizer->allows($user, 'companies.update', $company->id);
    }

    public function delete(User $user, Company $company): bool
    {
        return $this->authorizer->allows($user, 'companies.delete', $company->id);
    }
}
