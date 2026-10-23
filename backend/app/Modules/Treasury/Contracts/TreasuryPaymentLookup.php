<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Contracts;

use App\Modules\Treasury\Data\TreasuryPaymentData;

interface TreasuryPaymentLookup
{
    /** Returns only posted, unreversed payments in the active company. */
    public function find(string $id): ?TreasuryPaymentData;

    public function findForUpdate(string $id): ?TreasuryPaymentData;

    /** @return list<TreasuryPaymentData> */
    public function forAccount(string $accountId, string $from, string $to, int $page = 1, int $perPage = 100): array;
}
