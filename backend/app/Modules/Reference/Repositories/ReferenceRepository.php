<?php

declare(strict_types=1);

namespace App\Modules\Reference\Repositories;

use App\Modules\Reference\Models\Location;
use App\Modules\Reference\Models\Warehouse;
use App\Modules\Reference\Services\ReferenceSchema;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

final class ReferenceRepository
{
    /** @return Builder<Model> */
    public function query(string $resource, ?string $warehouseId = null): Builder
    {
        $class = ReferenceSchema::model($resource);
        $query = $class::query();
        if ($class === Location::class) {
            Warehouse::query()->findOrFail($warehouseId);
            $query->where('warehouse_id', $warehouseId);
        }

        return $query;
    }
}
