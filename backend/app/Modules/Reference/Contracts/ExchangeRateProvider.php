<?php

declare(strict_types=1);

namespace App\Modules\Reference\Contracts;

use App\Modules\Reference\Exceptions\RateNotFound;
use DateTimeInterface;

interface ExchangeRateProvider
{
    /** @throws RateNotFound */
    public function rate(string $from, string $to, DateTimeInterface $date): string;
}
