<?php

declare(strict_types=1);

namespace App\Modules\Reference\Contracts;

interface PaymentTermLookup
{
    public function exists(string $id): bool;

    /** Due days of an active payment term of the active company (or a global one); null when unknown. */
    public function dueDays(string $id): ?int;
}
