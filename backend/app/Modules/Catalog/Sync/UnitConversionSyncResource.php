<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Sync;

use App\Modules\Catalog\Http\Resources\UnitConversionResource;
use App\Modules\Catalog\Models\UnitConversion;

final class UnitConversionSyncResource extends CatalogSyncResource
{
    public function name(): string
    {
        return 'unit-conversions';
    }

    public function table(): string
    {
        return 'unit_conversions';
    }

    protected function model(): string
    {
        return UnitConversion::class;
    }

    /** The REST index shows the two units; the manifest lists no embeds. */
    protected function with(): array
    {
        return ['fromUnit', 'toUnit'];
    }

    public function resourceClass(): string
    {
        return UnitConversionResource::class;
    }
}
