<?php

declare(strict_types=1);

namespace App\Modules\Reference\Contracts;

use App\Modules\Reference\Data\TaxCodeData;
use DateTimeInterface;

interface TaxCodeLookup
{
    public function find(string $idOrCode, ?DateTimeInterface $date = null): ?TaxCodeData;
}
