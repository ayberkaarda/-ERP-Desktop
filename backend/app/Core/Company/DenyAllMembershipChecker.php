<?php

declare(strict_types=1);

namespace App\Core\Company;

/**
 * Fails closed until a real checker is bound.
 */
final class DenyAllMembershipChecker implements MembershipChecker
{
    public function isMember(string $userId, string $companyId): bool
    {
        return false;
    }
}
