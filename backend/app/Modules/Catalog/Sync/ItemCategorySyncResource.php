<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Sync;

use App\Modules\Catalog\Http\Resources\ItemCategoryResource;
use App\Modules\Catalog\Models\ItemCategory;

final class ItemCategorySyncResource extends CatalogSyncResource
{
    public function name(): string
    {
        return 'item-categories';
    }

    public function table(): string
    {
        return 'item_categories';
    }

    protected function model(): string
    {
        return ItemCategory::class;
    }

    public function resourceClass(): string
    {
        return ItemCategoryResource::class;
    }
}
