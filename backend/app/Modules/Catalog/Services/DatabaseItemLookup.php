<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Services;

use App\Modules\Catalog\Contracts\ItemLookup;
use App\Modules\Catalog\Data\BarcodeMatch;
use App\Modules\Catalog\Data\ItemData;
use App\Modules\Catalog\Models\Item;
use App\Modules\Catalog\Models\ItemBarcode;
use App\Modules\Catalog\Models\ItemVariant;
use Illuminate\Support\Str;

final class DatabaseItemLookup implements ItemLookup
{
    public function exists(string $itemId): bool
    {
        return Str::isUuid($itemId) && Item::query()->whereKey($itemId)->exists();
    }

    public function find(string $itemId): ?ItemData
    {
        $item = Str::isUuid($itemId) ? Item::query()->find($itemId) : null;

        return $item instanceof Item ? self::data($item) : null;
    }

    public function findByCode(string $code): ?ItemData
    {
        $item = Item::query()->where('code', $code)->first();

        return $item instanceof Item ? self::data($item) : null;
    }

    public function findByBarcode(string $barcode): ?BarcodeMatch
    {
        $match = ItemBarcode::query()->where('barcode', $barcode)->first();
        $item = $match === null ? null : Item::query()->find($match->item_id);

        if ($match === null || ! $item instanceof Item) {
            return null;
        }

        return new BarcodeMatch(self::data($item), $match->variant_id, $match->unit_id, $match->barcode, $match->type->value);
    }

    public function variantBelongsTo(string $variantId, string $itemId): bool
    {
        return Str::isUuid($variantId) && Str::isUuid($itemId)
            && ItemVariant::query()->whereKey($variantId)->where('item_id', $itemId)->exists();
    }

    public static function data(Item $item): ItemData
    {
        return new ItemData(
            $item->id,
            $item->code,
            $item->name,
            $item->type->value,
            $item->base_unit_id,
            $item->category_id,
            $item->default_tax_code_id,
            $item->purchase_tax_code_id,
            $item->tracking->value,
            $item->has_expiry,
            $item->is_active,
        );
    }
}
