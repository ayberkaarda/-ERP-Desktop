<?php

declare(strict_types=1);

namespace App\Modules\Identity\Contracts;

use App\Models\User;

/**
 * Permission checks against an explicit company, independent of the active company context.
 */
interface CompanyAuthorizer
{
    public function allows(User $user, string $permission, string $companyId): bool;

    /**
     * Permission names per company for every company the user may enter.
     *
     * @return array<string, list<string>>
     */
    public function permissionsByCompany(User $user): array;

    /** Drops memoized permissions after role or membership changes. */
    public function forget(?string $userId = null): void;
}
