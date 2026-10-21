<?php

declare(strict_types=1);

namespace App\Modules\Reference\Services;

use App\Modules\Reference\Contracts\PaymentTermLookup;
use App\Modules\Reference\Models\PaymentTerm;

final class DatabasePaymentTermLookup implements PaymentTermLookup
{
    public function exists(string $id): bool
    {
        return PaymentTerm::query()->where('id', $id)->where('is_active', true)->exists();
    }
}
