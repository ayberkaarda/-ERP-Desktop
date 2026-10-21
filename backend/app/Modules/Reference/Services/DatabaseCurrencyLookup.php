<?php

declare(strict_types=1);

namespace App\Modules\Reference\Services;

use App\Modules\Reference\Contracts\CurrencyLookup;
use App\Modules\Reference\Models\Currency;

final class DatabaseCurrencyLookup implements CurrencyLookup
{
    public function exists(string $code): bool
    {
        return Currency::query()->where('code', $code)->where('is_active', true)->exists();
    }
}
