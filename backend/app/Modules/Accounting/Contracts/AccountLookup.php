<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Contracts;

use App\Modules\Accounting\Data\AccountData;

/**
 * Read access to accounts of the active company.
 */
interface AccountLookup
{
    public function find(string $id): ?AccountData;

    public function findByCode(string $code): ?AccountData;
}
