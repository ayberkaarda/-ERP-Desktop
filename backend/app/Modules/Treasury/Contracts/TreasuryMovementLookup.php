<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Contracts;

use App\Modules\Treasury\Data\TreasuryMovementData;

interface TreasuryMovementLookup
{
    public function findForUpdate(string $id): ?TreasuryMovementData;

    public function forPayment(string $paymentId): ?TreasuryMovementData;
}
