<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Sync;

use App\Modules\Catalog\Http\Resources\ItemResource;
use App\Modules\Catalog\Models\Item;

final class ItemSyncResource extends CatalogSyncResource
{
    public function name(): string
    {
        return 'items';
    }

    public function table(): string
    {
        return 'items';
    }

    protected function model(): string
    {
        return Item::class;
    }

    public function resourceClass(): string
    {
        return ItemResource::class;
    }

    public function embeds(): array
    {
        return ['base_unit', 'category', 'units'];
    }

    protected function with(): array
    {
        return ['baseUnit', 'category', 'units', 'units.unit'];
    }
}
