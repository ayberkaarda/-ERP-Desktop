<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Services;

use App\Modules\Catalog\Models\Item;
use App\Modules\Catalog\Models\ItemBarcode;
use App\Modules\Catalog\Models\ItemUnit;
use App\Modules\Catalog\Models\ItemVariant;
use App\Modules\Catalog\Models\PriceListLine;
use App\Modules\Catalog\Models\Unit;
use Brick\Math\BigRational;

/**
 * Variants, barcodes and alternate units of an item. Every write locks the item row so the
 * per-item invariants (one primary barcode, generated SKU suffixes) hold under concurrency.
 */
final class ItemPartsService
{
    public const int SKU_LENGTH = 64;

    public const array VARIANT_INDEXES = ['item_variants_company_sku_unique' => 'sku'];

    public const array BARCODE_INDEXES = ['item_barcodes_company_id_barcode_unique' => 'barcode', 'item_barcodes_primary_unique' => 'is_primary'];

    public const array UNIT_INDEXES = ['item_units_item_id_unit_id_unique' => 'unit_id'];

    /**
     * @param  array<string, mixed>  $data
     */
    public function createVariant(Item $item, array $data): ItemVariant
    {
        return CatalogRules::transaction(function () use ($item, $data): ItemVariant {
            $locked = $this->lock($item);
            $variant = new ItemVariant(collect($data)->only(['sku', 'name', 'attributes', 'is_active'])->all());
            $variant->item_id = $locked->id;

            if (! is_string($data['sku'] ?? null) || $data['sku'] === '') {
                $variant->sku = $this->nextSku($locked);
            }

            $variant->save();

            return $variant;
        }, self::VARIANT_INDEXES);
    }

    /**
     * @param  array<string, mixed>  $data
     */
    public function updateVariant(ItemVariant $variant, array $data, int $version): ItemVariant
    {
        return CatalogRules::transaction(function () use ($variant, $data, $version): ItemVariant {
            $variant->assertVersion($version);
            $variant->fill(collect($data)->only(['sku', 'name', 'attributes', 'is_active'])->all())->save();

            return $variant;
        }, self::VARIANT_INDEXES);
    }

    public function deleteVariant(Item $item, ItemVariant $variant, ?int $version = null): void
    {
        CatalogRules::transaction(function () use ($item, $variant, $version): void {
            $this->lock($item);
            $variant = CatalogRules::lockVersion($variant, $version);

            if (PriceListLine::query()->where('variant_id', $variant->id)->exists()) {
                CatalogRules::fail('variant', 'variant_in_use');
            }

            ItemBarcode::query()->where('variant_id', $variant->id)->get()->each->delete();
            $variant->delete();
        });
    }

    /**
     * @param  array<string, mixed>  $data  validated: barcode, type, unit_id, variant_id?, is_primary?
     */
    public function createBarcode(Item $item, array $data): ItemBarcode
    {
        return CatalogRules::transaction(function () use ($item, $data): ItemBarcode {
            $locked = $this->lock($item);
            $barcode = new ItemBarcode(collect($data)->only(['barcode', 'type', 'unit_id', 'variant_id', 'is_primary'])->all());
            $barcode->item_id = $locked->id;
            $this->assertBarcodeRefs($data);
            $hasPrimary = ItemBarcode::query()->where('item_id', $locked->id)->where('is_primary', true)->exists();

            // The first barcode of an item is its primary one.
            if (($data['is_primary'] ?? false) === true || ! $hasPrimary) {
                $this->clearPrimary($locked);
                $barcode->is_primary = true;
            }

            $barcode->save();

            return $barcode;
        }, self::BARCODE_INDEXES);
    }

    /**
     * @param  array<string, mixed>  $data
     */
    public function updateBarcode(Item $item, ItemBarcode $barcode, array $data, int $version): ItemBarcode
    {
        return CatalogRules::transaction(function () use ($item, $barcode, $data, $version): ItemBarcode {
            $locked = $this->lock($item);
            $barcode->assertVersion($version);
            $this->assertBarcodeRefs($data);

            if (($data['is_primary'] ?? null) === true && ! $barcode->is_primary) {
                $this->clearPrimary($locked);
            }

            $barcode->fill(collect($data)->only(['barcode', 'type', 'unit_id', 'variant_id', 'is_primary'])->all())->save();

            return $barcode;
        }, self::BARCODE_INDEXES);
    }

    public function deleteBarcode(Item $item, ItemBarcode $barcode, ?int $version = null): void
    {
        CatalogRules::transaction(function () use ($item, $barcode, $version): void {
            $locked = $this->lock($item);
            $barcode = CatalogRules::lockVersion($barcode, $version);
            $wasPrimary = $barcode->is_primary;
            $barcode->delete();

            if ($wasPrimary) {
                $next = ItemBarcode::query()->where('item_id', $locked->id)->orderBy('created_at')->orderBy('id')->first();
                $next?->forceFill(['is_primary' => true])->save();
            }
        });
    }

    /**
     * @param  array{unit_id: string, factor: string}  $data
     */
    public function createUnit(Item $item, array $data, UnitConverter $converter): ItemUnit
    {
        return CatalogRules::transaction(function () use ($item, $data, $converter): ItemUnit {
            $locked = $this->lock($item);
            CatalogRules::lock('units');

            if ($data['unit_id'] === $locked->base_unit_id) {
                CatalogRules::fail('unit_id', 'item_unit_is_base');
            }

            CatalogRules::sharedExists(Unit::class, [$data['unit_id']]) || CatalogRules::fail('unit_id', 'unit_missing');
            $this->assertConsistent($locked, $data['unit_id'], $data['factor'], $converter);

            $unit = new ItemUnit(['unit_id' => $data['unit_id'], 'factor' => $data['factor']]);
            $unit->item_id = $locked->id;
            $unit->save();

            return $unit;
        }, self::UNIT_INDEXES);
    }

    public function updateUnit(Item $item, ItemUnit $unit, string $factor, int $version, UnitConverter $converter): ItemUnit
    {
        return CatalogRules::transaction(function () use ($item, $unit, $factor, $version, $converter): ItemUnit {
            $locked = $this->lock($item);
            CatalogRules::lock('units');
            $fresh = ItemUnit::query()->whereKey($unit->id)->lockForUpdate()->firstOrFail();
            $fresh->assertVersion($version);
            $this->assertConsistent($locked, $fresh->unit_id, $factor, $converter);
            $fresh->fill(['factor' => $factor])->save();

            return $fresh;
        });
    }

    public function deleteUnit(Item $item, ItemUnit $unit, ?int $version = null): void
    {
        CatalogRules::transaction(function () use ($item, $unit, $version): void {
            $this->lock($item);
            $unit = CatalogRules::lockVersion($unit, $version);

            if (ItemBarcode::query()->where('item_id', $item->id)->where('unit_id', $unit->unit_id)->exists()
                || PriceListLine::query()->where('item_id', $item->id)->where('unit_id', $unit->unit_id)->exists()) {
                CatalogRules::fail('unit', 'unit_in_use');
            }

            $unit->delete();
        });
    }

    /**
     * Every pair of units of the item (base = 1, alternates = their factor, with the written one
     * replaced) that the company graph connects must have exactly the graph ratio, along any path.
     */
    private function assertConsistent(Item $item, string $unitId, string $factor, UnitConverter $converter): void
    {
        $factors = [$item->base_unit_id => BigRational::one()];

        foreach (ItemUnit::query()->where('item_id', $item->id)->get(['unit_id', 'factor']) as $alternate) {
            $factors[$alternate->unit_id] = BigRational::of($alternate->factor);
        }

        $factors[$unitId] = BigRational::of($factor);

        if ($converter->graph()->conflict($factors) !== null) {
            CatalogRules::fail('factor', 'conversion_inconsistent');
        }
    }

    /**
     * Re-checked under the item lock (variant deletes take it too); the unit is share locked.
     *
     * @param  array<string, mixed>  $data
     */
    private function assertBarcodeRefs(array $data): void
    {
        $unit = $data['unit_id'] ?? null;
        $variant = $data['variant_id'] ?? null;

        if (is_string($unit) && ! CatalogRules::sharedExists(Unit::class, [$unit])) {
            CatalogRules::fail('unit_id', 'reference_gone');
        }

        if (is_string($variant) && ! CatalogRules::sharedExists(ItemVariant::class, [$variant])) {
            CatalogRules::fail('variant_id', 'reference_gone');
        }
    }

    private function clearPrimary(Item $item): void
    {
        ItemBarcode::query()->where('item_id', $item->id)->where('is_primary', true)->get()
            ->each(fn (ItemBarcode $b): bool => $b->forceFill(['is_primary' => false])->save());
    }

    private function nextSku(Item $item): string
    {
        $n = ItemVariant::withTrashed()->where('item_id', $item->id)->count();

        do {
            $suffix = sprintf('-%03d', ++$n);
            // The SKU column is as long as the item code; keep room for the suffix.
            $sku = mb_substr($item->code, 0, self::SKU_LENGTH - strlen($suffix)).$suffix;
        } while (ItemVariant::query()->where('sku', $sku)->exists());

        return $sku;
    }

    private function lock(Item $item): Item
    {
        return Item::query()->whereKey($item->id)->lockForUpdate()->firstOrFail();
    }
}
