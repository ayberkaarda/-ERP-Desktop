<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Sync;

use App\Modules\Catalog\Http\Resources\UnitResource;
use App\Modules\Catalog\Models\Unit;

final class UnitSyncResource extends CatalogSyncResource
{
    public function name(): string
    {
        return 'units';
    }

    public function table(): string
    {
        return 'units';
    }

    protected function model(): string
    {
        return Unit::class;
    }

    public function resourceClass(): string
    {
        return UnitResource::class;
    }
}
