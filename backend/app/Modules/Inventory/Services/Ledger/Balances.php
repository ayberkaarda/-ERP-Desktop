<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Services\Ledger;

use App\Modules\Inventory\Support\Stock;
use Brick\Math\BigDecimal;
use Illuminate\Support\Facades\DB;

/**
 * The stock_balances rows of the locked pairs, held in memory while a posting runs: lookups for
 * allocation, deltas, and the UPSERT that writes them back.
 */
final class Balances
{
    /** @var array<string, array{item: string, warehouse: string, location: string, lot: string, on_hand: BigDecimal, reserved: BigDecimal}> */
    private array $rows = [];

    /** @var array<string, array{on_hand: BigDecimal, reserved: BigDecimal}> */
    private array $deltas = [];

    /** @var array<string, BigDecimal> */
    private array $before = [];

    public function __construct(private readonly string $companyId) {}

    public static function key(string $item, string $warehouse, ?string $location, ?string $lot): string
    {
        return $item.'|'.$warehouse.'|'.Stock::key($location).'|'.Stock::key($lot);
    }

    /**
     * Locks every balance row of the pairs, in key order (the pairs' valuation rows are already locked).
     *
     * @param  list<array{0: string, 1: string}>  $pairs
     */
    public function lock(array $pairs): void
    {
        if ($pairs === []) {
            return;
        }

        $rows = DB::table('stock_balances')->where('company_id', $this->companyId)
            ->where(function ($q) use ($pairs): void {
                foreach ($pairs as [$item, $warehouse]) {
                    $q->orWhere(fn ($w) => $w->where('item_id', $item)->where('warehouse_id', $warehouse));
                }
            })
            ->orderBy('item_id')->orderBy('warehouse_id')->orderBy('location_id')->orderBy('lot_id')
            ->lockForUpdate()->get(['item_id', 'warehouse_id', 'location_id', 'lot_id', 'on_hand', 'reserved']);

        foreach ($rows as $r) {
            $key = self::key((string) $r->item_id, (string) $r->warehouse_id, (string) $r->location_id, (string) $r->lot_id);
            $this->rows[$key] = [
                'item' => (string) $r->item_id, 'warehouse' => (string) $r->warehouse_id, 'location' => (string) $r->location_id, 'lot' => (string) $r->lot_id,
                'on_hand' => Stock::dec((string) $r->on_hand), 'reserved' => Stock::dec((string) $r->reserved),
            ];
        }
    }

    public function onHand(string $key): BigDecimal
    {
        return $this->rows[$key]['on_hand'] ?? BigDecimal::zero();
    }

    /**
     * Rows of one pair with stock on hand, optionally of one location and/or lot.
     *
     * @return list<array{key: string, location: string, lot: string, on_hand: BigDecimal}>
     */
    public function positive(string $item, string $warehouse, ?string $location = null, ?string $lot = null, bool $anyLot = false): array
    {
        $found = [];

        foreach ($this->rows as $key => $row) {
            if ($row['item'] !== $item || $row['warehouse'] !== $warehouse || ! $row['on_hand']->isPositive()) {
                continue;
            }

            if ($location !== null && $row['location'] !== $location) {
                continue;
            }

            if (! $anyLot && $row['lot'] !== Stock::key($lot)) {
                continue;
            }

            if ($anyLot && $row['lot'] === Stock::NIL) {
                continue;
            }

            $found[] = ['key' => $key, 'location' => $row['location'], 'lot' => $row['lot'], 'on_hand' => $row['on_hand']];
        }

        return $found;
    }

    /**
     * Totals of a pair (optionally one lot): [on hand, reserved].
     *
     * @return array{0: BigDecimal, 1: BigDecimal}
     */
    public function totals(string $item, string $warehouse, ?string $lot = null): array
    {
        $onHand = BigDecimal::zero();
        $reserved = BigDecimal::zero();

        foreach ($this->rows as $row) {
            if ($row['item'] === $item && $row['warehouse'] === $warehouse && ($lot === null || $row['lot'] === $lot)) {
                $onHand = $onHand->plus($row['on_hand']);
                $reserved = $reserved->plus($row['reserved']);
            }
        }

        return [$onHand, $reserved];
    }

    /**
     * Totals per lot of a pair (lots only): lot id => [on hand, reserved].
     *
     * @return array<string, array{0: BigDecimal, 1: BigDecimal}>
     */
    public function lotTotals(string $item, string $warehouse): array
    {
        $lots = [];

        foreach ($this->rows as $row) {
            if ($row['item'] !== $item || $row['warehouse'] !== $warehouse || $row['lot'] === Stock::NIL) {
                continue;
            }

            [$onHand, $reserved] = $lots[$row['lot']] ?? [BigDecimal::zero(), BigDecimal::zero()];
            $lots[$row['lot']] = [$onHand->plus($row['on_hand']), $reserved->plus($row['reserved'])];
        }

        return $lots;
    }

    public function add(string $item, string $warehouse, ?string $location, ?string $lot, BigDecimal $onHand, ?BigDecimal $reserved = null): void
    {
        $key = self::key($item, $warehouse, $location, $lot);
        $reserved ??= BigDecimal::zero();
        $this->rows[$key] ??= ['item' => $item, 'warehouse' => $warehouse, 'location' => Stock::key($location), 'lot' => Stock::key($lot), 'on_hand' => BigDecimal::zero(), 'reserved' => BigDecimal::zero()];
        $this->before[$key] ??= $this->rows[$key]['on_hand'];
        $this->rows[$key]['on_hand'] = $this->rows[$key]['on_hand']->plus($onHand);
        $this->rows[$key]['reserved'] = $this->rows[$key]['reserved']->plus($reserved);
        $this->deltas[$key] ??= ['on_hand' => BigDecimal::zero(), 'reserved' => BigDecimal::zero()];
        $this->deltas[$key]['on_hand'] = $this->deltas[$key]['on_hand']->plus($onHand);
        $this->deltas[$key]['reserved'] = $this->deltas[$key]['reserved']->plus($reserved);
    }

    /**
     * Rows whose on hand went down and ended below zero.
     *
     * @return list<array{item: string, warehouse: string, on_hand: BigDecimal}>
     */
    public function newlyNegative(): array
    {
        $found = [];

        foreach ($this->before as $key => $before) {
            $row = $this->rows[$key];

            if ($row['on_hand']->isNegative() && $row['on_hand']->isLessThan($before)) {
                $found[] = ['item' => $row['item'], 'warehouse' => $row['warehouse'], 'on_hand' => $row['on_hand']];
            }
        }

        return $found;
    }

    /**
     * Pairs whose on hand went down.
     *
     * @return list<array{0: string, 1: string}>
     */
    public function decreasedPairs(): array
    {
        $pairs = [];

        foreach ($this->deltas as $key => $delta) {
            if ($delta['on_hand']->isNegative()) {
                $row = $this->rows[$key];
                $pairs[$row['item'].'|'.$row['warehouse']] = [$row['item'], $row['warehouse']];
            }
        }

        return array_values($pairs);
    }

    public function persist(): void
    {
        foreach ($this->deltas as $key => $delta) {
            if ($delta['on_hand']->isZero() && $delta['reserved']->isZero()) {
                continue;
            }

            $row = $this->rows[$key];
            $onHand = Stock::qty($delta['on_hand']);
            $reserved = Stock::qty($delta['reserved']);
            // UPDATE first: check constraints judge an INSERT ... ON CONFLICT row before the conflict,
            // so negative deltas cannot go through an upsert. The pair lock rules out a concurrent insert.
            $updated = DB::update(
                'UPDATE stock_balances SET on_hand = on_hand + ?, reserved = reserved + ?, updated_at = now()
                 WHERE company_id = ? AND item_id = ? AND warehouse_id = ? AND location_id = ? AND lot_id = ?',
                [$onHand, $reserved, $this->companyId, $row['item'], $row['warehouse'], $row['location'], $row['lot']],
            );

            if ($updated === 0) {
                DB::table('stock_balances')->insert([
                    'company_id' => $this->companyId, 'item_id' => $row['item'], 'warehouse_id' => $row['warehouse'],
                    'location_id' => $row['location'], 'lot_id' => $row['lot'], 'on_hand' => $onHand, 'reserved' => $reserved, 'updated_at' => now(),
                ]);
            }
        }

        $this->deltas = [];
        $this->before = [];
    }
}
