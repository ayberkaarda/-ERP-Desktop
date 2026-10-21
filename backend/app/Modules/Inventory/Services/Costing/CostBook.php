<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Services\Costing;

use App\Modules\Inventory\Enums\ValuationMethod;
use App\Modules\Inventory\Support\Stock;
use Brick\Math\BigDecimal;
use Illuminate\Support\Facades\DB;

/**
 * Loads (under row locks) and writes back the valuation rows and FIFO layers of the item/warehouse
 * pairs a posting touches. The valuation row of a pair is the pair's mutex: every change of its
 * balances, layers or reservations locks it first, always in (item, warehouse) order.
 */
final class CostBook
{
    /** @var array<string, Pair> */
    private array $pairs = [];

    public function __construct(private readonly string $companyId) {}

    /**
     * @param  list<array{0: string, 1: string}>  $keys  [item id, warehouse id]
     * @param  list<string>  $layerIds  layers to load even when empty (reversals)
     * @param  list<string>  $layerMovements  layers of these movements, even when empty (reversals)
     */
    public function lock(array $keys, ValuationMethod $method, array $layerIds = [], array $layerMovements = []): void
    {
        $unique = [];

        foreach ($keys as [$item, $warehouse]) {
            $unique[Pair::key($item, $warehouse)] = [$item, $warehouse];
        }

        ksort($unique, SORT_STRING);

        if ($unique === []) {
            return;
        }

        $rows = [];

        foreach ($unique as [$item, $warehouse]) {
            $rows[] = ['company_id' => $this->companyId, 'item_id' => $item, 'warehouse_id' => $warehouse, 'updated_at' => now()];
        }

        // Sorted inserts and sorted locks: two postings over the same pairs queue instead of deadlocking.
        DB::table('stock_valuations')->insertOrIgnore($rows);

        $locked = DB::table('stock_valuations')->where('company_id', $this->companyId)
            ->where(function ($q) use ($unique): void {
                foreach ($unique as [$item, $warehouse]) {
                    $q->orWhere(fn ($w) => $w->where('item_id', $item)->where('warehouse_id', $warehouse));
                }
            })
            ->orderBy('item_id')->orderBy('warehouse_id')->lockForUpdate()->get();

        foreach ($locked as $row) {
            $key = Pair::key((string) $row->item_id, (string) $row->warehouse_id);
            $this->pairs[$key] = new Pair((string) $row->item_id, (string) $row->warehouse_id, Stock::dec((string) $row->quantity), Stock::dec((string) $row->value), Stock::dec((string) $row->avg_cost));
        }

        if ($method === ValuationMethod::Fifo) {
            $this->loadLayers($unique, $layerIds, $layerMovements);
        }
    }

    public function pair(string $itemId, string $warehouseId): Pair
    {
        return $this->pairs[Pair::key($itemId, $warehouseId)] ?? throw new \LogicException('Pair not locked: '.$itemId.'/'.$warehouseId);
    }

    /** @return array<string, Pair> */
    public function pairs(): array
    {
        return $this->pairs;
    }

    /** Writes changed valuation rows and layers (after the movements they reference exist). */
    public function persist(): void
    {
        foreach ($this->pairs as $pair) {
            foreach ($pair->layers as $layer) {
                if (! $layer->dirty) {
                    continue;
                }

                if ($layer->isNew) {
                    DB::table('stock_cost_layers')->insert([
                        'id' => $layer->id, 'company_id' => $this->companyId, 'item_id' => $pair->itemId, 'warehouse_id' => $pair->warehouseId,
                        'movement_id' => $layer->movementId, 'original_qty' => Stock::qty($layer->originalQty), 'remaining_qty' => Stock::qty($layer->remainingQty),
                        'remaining_value' => (string) Stock::money($layer->remainingValue), 'unit_cost' => (string) $layer->unitCost, 'received_at' => $layer->receivedAt,
                        'created_at' => now(),
                    ]);
                } else {
                    DB::table('stock_cost_layers')->where('id', $layer->id)->update([
                        'remaining_qty' => Stock::qty($layer->remainingQty), 'remaining_value' => (string) Stock::money($layer->remainingValue),
                    ]);
                }

                $layer->dirty = false;
            }

            if (! $pair->dirty) {
                continue;
            }

            DB::table('stock_valuations')->where('company_id', $this->companyId)->where('item_id', $pair->itemId)->where('warehouse_id', $pair->warehouseId)
                ->update(['quantity' => Stock::qty($pair->quantity), 'value' => (string) Stock::money($pair->value), 'avg_cost' => (string) $pair->avgCost, 'updated_at' => now()]);
            // Balance rows show the pair's average and their share of its value.
            BalanceValues::distribute($this->companyId, $pair->itemId, $pair->warehouseId, $pair->avgCost, Stock::money($pair->value));
            $pair->dirty = false;
        }
    }

    /**
     * @param  array<string, array{0: string, 1: string}>  $unique
     * @param  list<string>  $layerIds
     * @param  list<string>  $layerMovements
     */
    private function loadLayers(array $unique, array $layerIds, array $layerMovements): void
    {
        $rows = DB::table('stock_cost_layers')->where('company_id', $this->companyId)
            ->where(function ($q) use ($unique): void {
                foreach ($unique as [$item, $warehouse]) {
                    $q->orWhere(fn ($w) => $w->where('item_id', $item)->where('warehouse_id', $warehouse));
                }
            })
            ->where(function ($q) use ($layerIds, $layerMovements): void {
                $q->where('remaining_qty', '>', 0);

                if ($layerIds !== []) {
                    $q->orWhereIn('id', $layerIds);
                }

                if ($layerMovements !== []) {
                    $q->orWhereIn('movement_id', $layerMovements);
                }
            })
            ->orderBy('received_at')->orderBy('id')->lockForUpdate()->get();

        foreach ($rows as $row) {
            $pair = $this->pairs[Pair::key((string) $row->item_id, (string) $row->warehouse_id)] ?? null;

            if ($pair === null) {
                continue;
            }

            $pair->layers[] = new Layer(
                (string) $row->id, (string) $row->movement_id, BigDecimal::of((string) $row->original_qty), BigDecimal::of((string) $row->remaining_qty),
                BigDecimal::of((string) $row->remaining_value), BigDecimal::of((string) $row->unit_cost), (string) $row->received_at,
            );
        }
    }
}
