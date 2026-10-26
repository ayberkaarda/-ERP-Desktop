<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Contracts;

use App\Modules\Catalog\Data\UnitData;
use App\Modules\Catalog\Services\UnitConversionMissing;

/**
 * Units of the active company and exact conversions between them (decimal strings, never floats).
 */
interface UnitLookup
{
    public function exists(string $unitId): bool;

    public function find(string $unitId): ?UnitData;

    /**
     * With an item, its base unit and alternate units are used first, then the company graph.
     *
     * @param  int<0, max>  $scale
     *
     * @throws UnitConversionMissing
     */
    public function convert(string $qty, string $fromUnitId, string $toUnitId, ?string $itemId = null, int $scale = 6): string;

    public function canConvert(string $fromUnitId, string $toUnitId, ?string $itemId = null): bool;
}
