<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Services;

use App\Core\Money\RoundingPolicy;
use App\Modules\Catalog\Models\Item;
use App\Modules\Catalog\Models\ItemUnit;
use App\Modules\Catalog\Models\UnitConversion;
use Brick\Math\BigDecimal;
use Brick\Math\BigNumber;
use Brick\Math\BigRational;
use Illuminate\Support\Str;

/**
 * Exact quantity conversion for the active company (brick/math, never floats).
 *
 * With an item: each unit is first expressed in the base unit of the item (base = 1, alternate
 * unit = its item factor, any other unit through the company graph); without one, or when that
 * fails, the company conversion graph is used directly. Data is loaded once per instance.
 */
final class UnitConverter
{
    private ?UnitGraph $graph = null;

    /** @var array<string, array{base: string, units: array<string, BigRational>}|null> */
    private array $items = [];

    public function graph(): UnitGraph
    {
        if ($this->graph === null) {
            $edges = [];

            foreach (UnitConversion::query()->orderBy('id')->get(['from_unit_id', 'to_unit_id', 'factor']) as $conversion) {
                $edges[] = ['from' => $conversion->from_unit_id, 'to' => $conversion->to_unit_id, 'factor' => $conversion->factor];
            }

            $this->graph = new UnitGraph($edges);
        }

        return $this->graph;
    }

    /** 1 $from = factor $to, or null when the units are not convertible. */
    public function tryFactor(string $from, string $to, ?string $itemId = null): ?BigRational
    {
        if ($from === $to) {
            return BigRational::one();
        }

        $item = $itemId === null ? null : $this->item($itemId);

        if ($item !== null) {
            $fromBase = $this->toBase($from, $item);
            $toBase = $this->toBase($to, $item);

            if ($fromBase !== null && $toBase !== null) {
                return $fromBase->dividedBy($toBase);
            }
        }

        return $this->graph()->factor($from, $to);
    }

    /**
     * @throws UnitConversionMissing
     */
    public function factor(string $from, string $to, ?string $itemId = null, string $field = 'unit_id'): BigRational
    {
        return $this->tryFactor($from, $to, $itemId) ?? throw new UnitConversionMissing($from, $to, $field);
    }

    public function canConvert(string $from, string $to, ?string $itemId = null): bool
    {
        return $this->tryFactor($from, $to, $itemId) !== null;
    }

    /**
     * @param  int<0, max>  $scale
     *
     * @throws UnitConversionMissing
     */
    public function convert(BigNumber|string $qty, string $from, string $to, ?string $itemId = null, int $scale = RoundingPolicy::DECIMAL_SCALE): BigDecimal
    {
        return BigRational::of($qty)->multipliedBy($this->factor($from, $to, $itemId))->toScale($scale, RoundingPolicy::MODE);
    }

    /** Exact (unrounded) conversion. */
    public function convertExact(BigNumber|string $qty, string $from, string $to, ?string $itemId = null): BigRational
    {
        return BigRational::of($qty)->multipliedBy($this->factor($from, $to, $itemId));
    }

    /**
     * Loads base and alternate units of many items with two queries (bulk validation).
     *
     * @param  list<string>  $itemIds
     */
    public function preload(array $itemIds): void
    {
        $missing = array_values(array_filter(array_unique($itemIds), fn (string $id): bool => ! array_key_exists($id, $this->items)));

        if ($missing === []) {
            return;
        }

        foreach ($missing as $id) {
            $this->items[$id] = null;
        }

        foreach (Item::query()->whereIn('id', $missing)->get(['id', 'base_unit_id']) as $item) {
            $this->items[$item->id] = ['base' => $item->base_unit_id, 'units' => []];
        }

        foreach (ItemUnit::query()->whereIn('item_id', $missing)->get(['item_id', 'unit_id', 'factor']) as $unit) {
            if (isset($this->items[$unit->item_id])) {
                $this->items[$unit->item_id]['units'][$unit->unit_id] = BigRational::of($unit->factor);
            }
        }
    }

    /** Base unit of an item of the active company, null when unknown. */
    public function baseUnitOf(string $itemId): ?string
    {
        return $this->item($itemId)['base'] ?? null;
    }

    /** Drops cached data after writes made through this instance. */
    public function forget(): void
    {
        $this->graph = null;
        $this->items = [];
    }

    /**
     * @param  array{base: string, units: array<string, BigRational>}  $item
     */
    private function toBase(string $unit, array $item): ?BigRational
    {
        if ($unit === $item['base']) {
            return BigRational::one();
        }

        if (isset($item['units'][$unit])) {
            return $item['units'][$unit];
        }

        $direct = $this->graph()->factor($unit, $item['base']);

        if ($direct !== null) {
            return $direct;
        }

        // A graph-only unit may reach the base through one of the alternate units of the item.
        $alternates = $item['units'];
        ksort($alternates);

        foreach ($alternates as $alternate => $toBase) {
            $factor = $this->graph()->factor($unit, (string) $alternate);

            if ($factor !== null) {
                return $factor->multipliedBy($toBase);
            }
        }

        return null;
    }

    /**
     * @return array{base: string, units: array<string, BigRational>}|null
     */
    private function item(string $itemId): ?array
    {
        if (! Str::isUuid($itemId)) {
            return null;
        }

        if (! array_key_exists($itemId, $this->items)) {
            $base = Item::query()->whereKey($itemId)->value('base_unit_id');
            $units = [];

            if (is_string($base)) {
                foreach (ItemUnit::query()->where('item_id', $itemId)->get(['unit_id', 'factor']) as $unit) {
                    $units[$unit->unit_id] = BigRational::of($unit->factor);
                }
            }

            $this->items[$itemId] = is_string($base) ? ['base' => $base, 'units' => $units] : null;
        }

        return $this->items[$itemId];
    }
}
