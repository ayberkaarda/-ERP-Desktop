<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Sync;

use App\Modules\Catalog\Http\Resources\PriceListLineResource;
use App\Modules\Catalog\Models\PriceListLine;

final class PriceListLineSyncResource extends CatalogSyncResource
{
    public function name(): string
    {
        return 'price-lists.lines';
    }

    public function table(): string
    {
        return 'price_list_lines';
    }

    protected function model(): string
    {
        return PriceListLine::class;
    }

    public function resourceClass(): string
    {
        return PriceListLineResource::class;
    }

    public function parentKey(): string
    {
        return 'price_list_id';
    }
}
