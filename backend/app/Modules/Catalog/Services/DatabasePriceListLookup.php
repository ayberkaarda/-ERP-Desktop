<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Services;

use App\Modules\Catalog\Contracts\PriceListLookup;
use App\Modules\Catalog\Models\PriceList;
use Illuminate\Support\Str;

final class DatabasePriceListLookup implements PriceListLookup
{
    public function exists(string $priceListId): bool
    {
        return Str::isUuid($priceListId) && PriceList::query()->whereKey($priceListId)->exists();
    }

    public function currency(string $priceListId): ?string
    {
        $currency = Str::isUuid($priceListId) ? PriceList::query()->whereKey($priceListId)->value('currency_code') : null;

        return is_string($currency) ? $currency : null;
    }
}
