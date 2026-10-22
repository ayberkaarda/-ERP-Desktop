<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Contracts;

use App\Modules\Purchasing\Data\SupplierPerformanceData;
use DateTimeInterface;

/**
 * Delivery, price and return figures of a supplier over a period (input of a supplier risk score).
 */
interface SupplierPerformance
{
    public function forParty(string $companyId, string $partyId, DateTimeInterface $from, DateTimeInterface $to): SupplierPerformanceData;
}
