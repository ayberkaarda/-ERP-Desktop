<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Services;

use App\Modules\Catalog\Models\Item;
use App\Modules\Catalog\Models\ItemBarcode;
use App\Modules\Catalog\Models\ItemUnit;
use App\Modules\Catalog\Models\PriceListLine;
use App\Modules\Catalog\Models\Unit;
use App\Modules\Catalog\Models\UnitConversion;
use Brick\Math\BigRational;
use Illuminate\Support\Facades\DB;

/**
 * Units and the company conversion graph. Graph writes take a per-company advisory lock and
 * keep three invariants: factor > 0, no cycles (a forest, so every path agrees) and base unit
 * consistency (an alternate unit factor of an item never contradicts the graph).
 */
final class UnitService
{
    public const array INDEXES = ['units_company_code_unique' => 'code'];

    public const array CONVERSION_INDEXES = ['unit_conversions_pair_unique' => 'to_unit_id'];

    public function delete(Unit $unit, ?int $version = null): void
    {
        DB::transaction(function () use ($unit, $version): void {
            CatalogRules::lock('units');
            $unit = CatalogRules::lockVersion($unit, $version);
            $id = $unit->id;
            $used = Item::withTrashed()->where('base_unit_id', $id)->exists()
                || ItemUnit::query()->where('unit_id', $id)->exists()
                || ItemBarcode::query()->where('unit_id', $id)->exists()
                || PriceListLine::query()->where('unit_id', $id)->exists()
                || UnitConversion::query()->where(fn ($q) => $q->where('from_unit_id', $id)->orWhere('to_unit_id', $id))->exists();

            if ($used) {
                CatalogRules::fail('unit', 'unit_in_use');
            }

            $unit->delete();
        });
    }

    public function createConversion(string $from, string $to, string $factor): UnitConversion
    {
        return CatalogRules::transaction(function () use ($from, $to, $factor): UnitConversion {
            CatalogRules::lock('units');
            $graph = $this->graph();

            if ($graph->wouldCreateCycle($from, $to)) {
                CatalogRules::fail('to_unit_id', 'conversion_cycle');
            }

            $graph->add($from, $to, $factor);
            $this->assertItemsConsistent($graph, $graph->component($from));

            $conversion = new UnitConversion(['from_unit_id' => $from, 'to_unit_id' => $to, 'factor' => $factor]);
            $conversion->save();

            return $conversion;
        }, self::CONVERSION_INDEXES);
    }

    public function updateConversion(UnitConversion $conversion, string $factor, int $version): UnitConversion
    {
        return DB::transaction(function () use ($conversion, $factor, $version): UnitConversion {
            CatalogRules::lock('units');
            $conversion->assertVersion($version);
            $graph = $this->graph($conversion->id);
            $graph->add($conversion->from_unit_id, $conversion->to_unit_id, $factor);
            $this->assertItemsConsistent($graph, $graph->component($conversion->from_unit_id));
            $conversion->fill(['factor' => $factor])->save();

            return $conversion;
        });
    }

    public function deleteConversion(UnitConversion $conversion, ?int $version = null): void
    {
        DB::transaction(function () use ($conversion, $version): void {
            CatalogRules::lock('units');
            CatalogRules::lockVersion($conversion, $version)->delete();
        });
    }

    private function graph(?string $except = null): UnitGraph
    {
        $edges = [];

        foreach (UnitConversion::query()->when($except !== null, fn ($q) => $q->whereKeyNot($except))->orderBy('id')->get() as $c) {
            $edges[] = ['from' => $c->from_unit_id, 'to' => $c->to_unit_id, 'factor' => $c->factor];
        }

        return new UnitGraph($edges);
    }

    /**
     * @param  list<string>  $units  one connected component of the new graph
     */
    private function assertItemsConsistent(UnitGraph $graph, array $units): void
    {
        // Only items with at least one alternate unit in the touched component can conflict.
        $itemIds = ItemUnit::query()->whereIn('unit_id', $units)->distinct()->pluck('item_id')->all();
        $items = Item::query()->whereIn('id', $itemIds)->get(['id', 'code', 'base_unit_id']);
        $alternates = ItemUnit::query()->whereIn('item_id', $itemIds)->get(['item_id', 'unit_id', 'factor'])->groupBy('item_id');

        foreach ($items as $item) {
            $factors = [$item->base_unit_id => BigRational::one()];

            foreach ($alternates->get($item->id, []) as $alternate) {
                $factors[$alternate->unit_id] = BigRational::of($alternate->factor);
            }

            if ($graph->conflict($factors) !== null) {
                CatalogRules::fail('factor', 'conversion_conflicts_item', ['item' => $item->code]);
            }
        }
    }
}
