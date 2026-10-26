<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Services;

use App\Modules\Catalog\Contracts\UnitLookup;
use App\Modules\Catalog\Data\UnitData;
use App\Modules\Catalog\Models\Unit;
use Illuminate\Support\Str;

final class DatabaseUnitLookup implements UnitLookup
{
    public function exists(string $unitId): bool
    {
        return Str::isUuid($unitId) && Unit::query()->whereKey($unitId)->exists();
    }

    public function find(string $unitId): ?UnitData
    {
        $unit = Str::isUuid($unitId) ? Unit::query()->find($unitId) : null;

        return $unit instanceof Unit ? new UnitData($unit->id, $unit->code, $unit->name, $unit->symbol, $unit->is_active) : null;
    }

    public function convert(string $qty, string $fromUnitId, string $toUnitId, ?string $itemId = null, int $scale = 6): string
    {
        return (string) (new UnitConverter)->convert($qty, $fromUnitId, $toUnitId, $itemId, $scale);
    }

    public function canConvert(string $fromUnitId, string $toUnitId, ?string $itemId = null): bool
    {
        return (new UnitConverter)->canConvert($fromUnitId, $toUnitId, $itemId);
    }
}
