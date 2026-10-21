<?php

declare(strict_types=1);

namespace App\Modules\Reference\Services;

use App\Modules\Reference\Contracts\WarehouseLookup;
use App\Modules\Reference\Models\Warehouse;

final class DatabaseWarehouseLookup implements WarehouseLookup
{
    public function exists(string $id): bool
    {
        return Warehouse::query()->where('id', $id)->where('is_active', true)->exists();
    }
}
