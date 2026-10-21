<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Contracts;

use App\Modules\Accounting\Exceptions\PeriodNotOpen;
use DateTimeInterface;

interface PeriodGuard
{
    /**
     * The date falls in an open period of an open fiscal year of the company.
     *
     * @throws PeriodNotOpen
     */
    public function assertOpen(string $companyId, DateTimeInterface $date): void;
}
