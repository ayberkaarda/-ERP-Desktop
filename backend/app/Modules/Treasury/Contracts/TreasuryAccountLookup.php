<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Contracts;

use App\Modules\Treasury\Data\TreasuryAccountData;
use App\Modules\Treasury\Data\TreasuryMovementData;

interface TreasuryAccountLookup
{
    public function find(string $id): ?TreasuryAccountData;

    public function balance(string $accountId, ?string $asOf = null): string;

    /** @return list<TreasuryMovementData> */
    public function movements(string $accountId, string $from, string $to, int $page = 1, int $perPage = 100): array;
}
