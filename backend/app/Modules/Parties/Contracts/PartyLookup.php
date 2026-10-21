<?php

declare(strict_types=1);

namespace App\Modules\Parties\Contracts;

use App\Modules\Parties\Data\PartyData;

/**
 * Read access to parties of the active company for other modules. Soft deleted parties are never
 * returned; inactive ones are (callers decide whether an inactive party is acceptable).
 */
interface PartyLookup
{
    public function find(string $id): ?PartyData;

    public function findByCode(string $code): ?PartyData;

    public function exists(string $id): bool;
}
