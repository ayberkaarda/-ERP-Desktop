<?php

declare(strict_types=1);

namespace App\Modules\Identity\Services;

use App\Core\Company\MembershipChecker;
use App\Models\User;
use App\Modules\Organization\Contracts\CompanyDirectory;
use Illuminate\Support\Str;

/**
 * Active users enter companies they are active members of; an active super admin enters any active company.
 */
final class IdentityMembershipChecker implements MembershipChecker
{
    public function __construct(private readonly CompanyDirectory $companies) {}

    public function isMember(string $userId, string $companyId): bool
    {
        if (! Str::isUuid($userId) || ! Str::isUuid($companyId)) {
            return false;
        }

        $user = User::query()->find($userId);

        if (! $user instanceof User || ! $user->is_active) {
            return false;
        }

        if ($user->is_super_admin) {
            return $this->companies->isActive($companyId);
        }

        return $this->companies->isActiveMember($userId, $companyId);
    }
}
