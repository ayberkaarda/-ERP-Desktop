<?php

declare(strict_types=1);

namespace App\Modules\Organization\Contracts;

/**
 * Existence checks of branches for other modules, answered for the active company: a branch of
 * another company, a soft deleted or an inactive branch does not exist for the caller.
 */
interface BranchLookup
{
    public function exists(string $id): bool;
}
