<?php

declare(strict_types=1);

namespace App\Core\Company;

/**
 * Bound by the identity module; Core only knows this contract.
 */
interface MembershipChecker
{
    public function isMember(string $userId, string $companyId): bool;
}
