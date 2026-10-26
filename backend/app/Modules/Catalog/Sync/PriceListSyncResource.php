<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Sync;

use App\Modules\Catalog\Http\Resources\PriceListResource;
use App\Modules\Catalog\Models\PriceList;

final class PriceListSyncResource extends CatalogSyncResource
{
    public function name(): string
    {
        return 'price-lists';
    }

    public function table(): string
    {
        return 'price_lists';
    }

    protected function model(): string
    {
        return PriceList::class;
    }

    public function resourceClass(): string
    {
        return PriceListResource::class;
    }
}
