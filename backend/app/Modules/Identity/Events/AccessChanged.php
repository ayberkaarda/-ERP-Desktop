<?php

declare(strict_types=1);

namespace App\Modules\Identity\Events;

use Illuminate\Foundation\Events\Dispatchable;

/**
 * The permissions of these users changed in one company (role permissions edited, roles assigned
 * or taken away, a role deleted) or, with companyId null, in every company (super admin flag).
 *
 * Dispatched synchronously inside the transaction of the change and after the permission memo
 * was cleared: listeners read the new permissions, and whatever they write commits or rolls back
 * with the change itself (the Sync module raises visibility generations from it).
 */
final class AccessChanged
{
    use Dispatchable;

    /**
     * @param  list<string>  $userIds
     */
    public function __construct(
        public readonly array $userIds,
        public readonly ?string $companyId,
    ) {}
}
