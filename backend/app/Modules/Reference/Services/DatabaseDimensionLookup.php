<?php

declare(strict_types=1);

namespace App\Modules\Reference\Services;

use App\Modules\Reference\Contracts\DimensionLookup;
use App\Modules\Reference\Models\CostCenter;
use App\Modules\Reference\Models\Project;

final class DatabaseDimensionLookup implements DimensionLookup
{
    public function exists(string $id): bool
    {
        return $this->costCenterExists($id) || $this->projectExists($id);
    }

    public function costCenterExists(string $id): bool
    {
        return CostCenter::query()->whereKey($id)->where('is_active', true)->exists();
    }

    public function projectExists(string $id): bool
    {
        return Project::query()->whereKey($id)->whereIn('status', ['planned', 'active', 'on_hold'])->exists();
    }
}
