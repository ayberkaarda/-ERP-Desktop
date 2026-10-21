<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Services\Costing;

use App\Modules\Inventory\Enums\ValuationMethod;
use App\Modules\Inventory\Support\Messages;
use App\Modules\Inventory\Support\Stock;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use Illuminate\Support\Str;

/**
 * Valuation arithmetic on a Pair (brick/math, half-even rounding; amounts at scale 4, unit costs
 * and averages at the company cost scale).
 *
 * Moving average: an inbound movement sets avg = (value + inbound value) / (quantity + inbound
 * quantity); outbound movements are costed at the current average, and the movement that empties
 * the stock takes the remaining value, so no residue stays at zero quantity.
 * FIFO: inbound movements open a layer; outbound movements consume layers oldest first, one costed
 * portion per layer (a fully consumed layer gives its remaining value).
 * Negative stock (where a warehouse allows it): the uncovered part is costed at the last known
 * average and is not corrected automatically by the next receipt.
 */
final class Valuator
{
    /**
     * @param  int<0, max>  $costScale
     */
    public function __construct(
        private readonly ValuationMethod $method,
        private readonly int $costScale = 6,
    ) {}

    public function method(): ValuationMethod
    {
        return $this->method;
    }

    /**
     * Books an inbound quantity. Without a unit cost or total the current average is used.
     *
     * @return array{unit_cost: BigDecimal, total_cost: BigDecimal, layer_id: string|null}
     */
    public function inbound(Pair $pair, BigDecimal $qty, ?BigDecimal $unitCost, ?BigDecimal $totalCost, string $receivedAt, string $movementId): array
    {
        $total = $totalCost !== null
            ? Stock::money($totalCost)
            : Stock::money($qty->multipliedBy($unitCost ?? $pair->avgCost));
        $unit = $unitCost !== null
            ? $unitCost->toScale($this->costScale, RoundingMode::HalfEven)
            : $this->unitOf($total, $qty, $pair->avgCost);

        $pair->quantity = $pair->quantity->plus($qty);
        $pair->value = $pair->value->plus($total);
        $pair->avgCost = $pair->quantity->isPositive() ? $this->average($pair->value, $pair->quantity) : $unit;
        $pair->dirty = true;
        $layerId = null;

        if ($this->method === ValuationMethod::Fifo) {
            $layerId = (string) Str::uuid7();
            $layer = new Layer($layerId, $movementId, $qty, $qty, $total, $unit, $receivedAt, isNew: true);
            $layer->dirty = true;
            $pair->layers[] = $layer;
        }

        return ['unit_cost' => $unit, 'total_cost' => $total, 'layer_id' => $layerId];
    }

    /**
     * Costs an outbound quantity: one portion (moving average) or one per consumed layer (FIFO).
     *
     * @return list<array{qty: BigDecimal, unit_cost: BigDecimal, total_cost: BigDecimal, layer_id: string|null, received_at: string|null}>
     */
    public function outbound(Pair $pair, BigDecimal $qty): array
    {
        $portions = $this->method === ValuationMethod::Fifo ? $this->consumeLayers($pair, $qty) : [];
        $covered = BigDecimal::zero();

        foreach ($portions as $p) {
            $covered = $covered->plus($p['qty']);
        }

        $rest = $qty->minus($covered);

        if ($rest->isPositive()) {
            if ($this->method === ValuationMethod::MovingAverage && $pair->quantity->isPositive() && $rest->isEqualTo($pair->quantity)) {
                $total = Stock::money($pair->value->isNegative() ? BigDecimal::zero() : $pair->value);
            } else {
                $total = Stock::money($rest->multipliedBy($pair->avgCost));

                if ($pair->quantity->isGreaterThanOrEqualTo($rest) && $total->isGreaterThan($pair->value) && ! $pair->value->isNegative()) {
                    $total = Stock::money($pair->value);
                }
            }

            $portions[] = ['qty' => $rest, 'unit_cost' => $pair->avgCost->toScale($this->costScale, RoundingMode::HalfEven), 'total_cost' => $total, 'layer_id' => null, 'received_at' => null];
        }

        foreach ($portions as $p) {
            $pair->quantity = $pair->quantity->minus($p['qty']);
            $pair->value = $pair->value->minus($p['total_cost']);
        }

        if ($pair->quantity->isPositive() && $this->method === ValuationMethod::Fifo) {
            $pair->avgCost = $this->average($pair->value, $pair->quantity);
        }

        $pair->dirty = true;

        return $portions;
    }

    /**
     * Undoes an inbound movement (its reversal leaves the stock at the original cost). Under FIFO
     * its layer must still be whole.
     */
    public function reverseInbound(Pair $pair, string $movementId, BigDecimal $qty, BigDecimal $total, string $field): void
    {
        if ($this->method === ValuationMethod::Fifo) {
            $layer = $pair->layerOfMovement($movementId);

            if ($layer !== null) {
                if (! $layer->remainingQty->isEqualTo($layer->originalQty)) {
                    Messages::fail($field, 'reverse_layer_consumed');
                }

                $layer->remainingQty = BigDecimal::zero();
                $layer->remainingValue = BigDecimal::zero();
                $layer->dirty = true;
            }
        }

        $pair->quantity = $pair->quantity->minus($qty);
        $pair->value = $pair->value->minus($total);
        $this->settleAverage($pair);
    }

    /**
     * Undoes an outbound movement: the quantity comes back at its original cost (into the FIFO layer
     * it was taken from).
     *
     * @return string|null a new layer id when the movement had no layer (FIFO negative portion)
     */
    public function reverseOutbound(Pair $pair, ?string $layerId, BigDecimal $qty, BigDecimal $total, BigDecimal $unitCost, string $receivedAt, string $movementId): ?string
    {
        $newLayer = null;

        if ($this->method === ValuationMethod::Fifo) {
            $layer = $layerId === null ? null : $pair->layer($layerId);

            if ($layer !== null) {
                $layer->remainingQty = $layer->remainingQty->plus($qty);
                $layer->remainingValue = $layer->remainingValue->plus($total);
                $layer->dirty = true;
            } else {
                $newLayer = (string) Str::uuid7();
                $created = new Layer($newLayer, $movementId, $qty, $qty, $total, $unitCost, $receivedAt, isNew: true);
                $created->dirty = true;
                $pair->layers[] = $created;
            }
        }

        $pair->quantity = $pair->quantity->plus($qty);
        $pair->value = $pair->value->plus($total);
        $this->settleAverage($pair);

        return $newLayer;
    }

    public function average(BigDecimal $value, BigDecimal $qty): BigDecimal
    {
        return $value->dividedBy($qty, $this->costScale, RoundingMode::HalfEven);
    }

    /**
     * @return list<array{qty: BigDecimal, unit_cost: BigDecimal, total_cost: BigDecimal, layer_id: string|null, received_at: string|null}>
     */
    private function consumeLayers(Pair $pair, BigDecimal $qty): array
    {
        $portions = [];
        $remaining = $qty;

        foreach ($pair->layers as $layer) {
            if (! $remaining->isPositive()) {
                break;
            }

            if (! $layer->remainingQty->isPositive()) {
                continue;
            }

            $take = $remaining->isLessThan($layer->remainingQty) ? $remaining : $layer->remainingQty;

            if ($take->isEqualTo($layer->remainingQty)) {
                $total = $layer->remainingValue;
            } else {
                $total = Stock::money($take->multipliedBy($layer->unitCost));
                $total = $total->isGreaterThan($layer->remainingValue) ? $layer->remainingValue : $total;
            }

            $layer->remainingQty = $layer->remainingQty->minus($take);
            $layer->remainingValue = $layer->remainingValue->minus($total);
            $layer->dirty = true;
            $remaining = $remaining->minus($take);
            $portions[] = ['qty' => $take, 'unit_cost' => $layer->unitCost, 'total_cost' => Stock::money($total), 'layer_id' => $layer->id, 'received_at' => $layer->receivedAt];
        }

        return $portions;
    }

    private function settleAverage(Pair $pair): void
    {
        if ($pair->quantity->isPositive()) {
            $pair->avgCost = $this->average($pair->value, $pair->quantity);
        }

        $pair->dirty = true;
    }

    private function unitOf(BigDecimal $total, BigDecimal $qty, BigDecimal $fallback): BigDecimal
    {
        return $qty->isPositive() ? $total->dividedBy($qty, $this->costScale, RoundingMode::HalfEven) : $fallback;
    }
}
