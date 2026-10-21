<?php

declare(strict_types=1);

namespace App\Modules\Reference\Contracts;

interface PaymentTermLookup
{
    public function exists(string $id): bool;
}
