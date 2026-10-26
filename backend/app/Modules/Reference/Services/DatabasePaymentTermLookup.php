<?php

declare(strict_types=1);

namespace App\Modules\Reference\Services;

use App\Modules\Reference\Contracts\PaymentTermLookup;
use App\Modules\Reference\Models\PaymentTerm;
use Illuminate\Support\Str;

final class DatabasePaymentTermLookup implements PaymentTermLookup
{
    public function exists(string $id): bool
    {
        return PaymentTerm::query()->where('id', $id)->where('is_active', true)->exists();
    }

    public function dueDays(string $id): ?int
    {
        if (! Str::isUuid($id)) {
            return null;
        }

        $days = PaymentTerm::query()->where('id', $id)->where('is_active', true)->value('due_days');

        return is_numeric($days) ? (int) $days : null;
    }
}
