<?php

declare(strict_types=1);

namespace App\Modules\Reference\Contracts;

interface CurrencyLookup
{
    public function exists(string $code): bool;
}
