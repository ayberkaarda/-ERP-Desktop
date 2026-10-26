<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Sync;

use App\Modules\Catalog\Http\Resources\ItemBarcodeResource;
use App\Modules\Catalog\Models\ItemBarcode;

final class ItemBarcodeSyncResource extends CatalogSyncResource
{
    public function name(): string
    {
        return 'items.barcodes';
    }

    public function table(): string
    {
        return 'item_barcodes';
    }

    protected function model(): string
    {
        return ItemBarcode::class;
    }

    public function resourceClass(): string
    {
        return ItemBarcodeResource::class;
    }

    public function parentKey(): string
    {
        return 'item_id';
    }
}
