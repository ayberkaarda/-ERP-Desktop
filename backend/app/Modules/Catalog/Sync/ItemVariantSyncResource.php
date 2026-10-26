<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Sync;

use App\Modules\Catalog\Http\Resources\ItemVariantResource;
use App\Modules\Catalog\Models\ItemVariant;

final class ItemVariantSyncResource extends CatalogSyncResource
{
    public function name(): string
    {
        return 'items.variants';
    }

    public function table(): string
    {
        return 'item_variants';
    }

    protected function model(): string
    {
        return ItemVariant::class;
    }

    public function resourceClass(): string
    {
        return ItemVariantResource::class;
    }

    public function parentKey(): string
    {
        return 'item_id';
    }
}
