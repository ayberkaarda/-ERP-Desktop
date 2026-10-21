<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Services\Reports;

use App\Modules\Inventory\Data\Reports\ReportFilters;
use App\Modules\Inventory\Data\Reports\ReportTable;
use App\Modules\Inventory\Enums\ValuationMethod;
use App\Modules\Inventory\Services\Costing\Layer;
use App\Modules\Inventory\Services\Costing\Pair;
use App\Modules\Inventory\Services\Costing\Valuator;
use App\Modules\Inventory\Support\InventorySettings;
use App\Modules\Inventory\Support\Stock;
use Brick\Math\BigDecimal;

/**
 * Stock valuation as of a date.
 *
 * With the company's own valuation method (default) the figures are the booked ones: the signed
 * total_cost of the movements up to as_of, which is what the stock account shows (basis "booked").
 * With the other method the movements up to as_of are replayed in posting order through the same
 * Valuator the ledger uses (basis "simulated"): inbound movements keep their booked cost, outbound
 * ones are re-costed (moving average, or FIFO layers in the ledger's own order: receipt date, then
 * creation order, so a backdated receipt is consumed first). A simulation is a what-if figure and
 * does not reconcile with the journal. Exhausted layers are dropped as they empty, so the replay
 * stays linear in the number of movements.
 */
final class ValuationReport
{
    public function __construct(
        private readonly ReportQuery $query,
        private readonly PairGroups $groups,
        private readonly InventorySettings $settings,
    ) {}

    public function build(ReportFilters $f, string $asOf, ?ValuationMethod $method, string $groupBy, bool $includeZero): ReportTable
    {
        $own = $this->settings->valuationMethod();
        $method ??= $own;
        $booked = $method === $own;
        $pairs = $booked ? array_values($this->query->pairTotals($f, $asOf)) : $this->simulate($f, $asOf, $method);

        return StockStatusReport::table($this->groups->group($f->companyId, $pairs, $groupBy, ['quantity', 'value']), $groupBy, $includeZero, [
            'as_of' => $asOf,
            'group_by' => $groupBy,
            'method' => $method->value,
            'company_method' => $own->value,
            'basis' => $booked ? 'booked' : 'simulated',
        ]);
    }

    /**
     * @return list<array{item_id: string, warehouse_id: string, quantity: BigDecimal, value: BigDecimal}>
     */
    private function simulate(ReportFilters $f, string $asOf, ValuationMethod $method): array
    {
        $valuator = new Valuator($method, $this->settings->costScale());
        /** @var array<string, Pair> $pairs */
        $pairs = [];
        $movements = $this->query->movements($f)->where('m.occurred_at', '<=', $asOf)->orderBy('m.seq')
            ->select(['m.id', 'm.item_id', 'm.warehouse_id', 'm.direction', 'm.quantity', 'm.total_cost', 'm.occurred_at'])
            ->cursor();

        foreach ($movements as $m) {
            $key = Pair::key((string) $m->item_id, (string) $m->warehouse_id);
            $pair = $pairs[$key] ??= new Pair((string) $m->item_id, (string) $m->warehouse_id, BigDecimal::zero(), BigDecimal::zero(), BigDecimal::zero());
            $qty = Stock::dec((string) $m->quantity);

            if ($m->direction === 'in') {
                $valuator->inbound($pair, $qty, null, Stock::dec((string) $m->total_cost), (string) $m->occurred_at, (string) $m->id);
                self::placeNewestLayer($pair);
            } else {
                $valuator->outbound($pair, $qty);
                self::dropConsumedLayers($pair);
            }
        }

        return array_values(array_map(static fn (Pair $p): array => [
            'item_id' => $p->itemId, 'warehouse_id' => $p->warehouseId, 'quantity' => $p->quantity, 'value' => $p->value,
        ], $pairs));
    }

    /**
     * The Valuator appends a new layer; a backdated receipt belongs before later-dated layers, in
     * the order the ledger itself consumes them (Layer::insertionIndex).
     */
    private static function placeNewestLayer(Pair $pair): void
    {
        $layers = $pair->layers;
        $count = count($layers);

        if ($count < 2) {
            return;
        }

        $new = $layers[$count - 1];

        if (strcmp($layers[$count - 2]->receivedAt, $new->receivedAt) <= 0) {
            return;
        }

        $rest = array_slice($layers, 0, $count - 1);
        $at = Layer::insertionIndex($rest, $new->receivedAt);

        if ($at < $count - 1) {
            array_splice($rest, $at, 0, [$new]);
            $pair->layers = $rest;
        }
    }

    /**
     * Layers are consumed from the front, so the exhausted ones form a prefix. It is cut off in
     * batches, so that neither consuming nor cutting rescans the open layers over and over.
     */
    private static function dropConsumedLayers(Pair $pair): void
    {
        $count = count($pair->layers);
        $exhausted = 0;

        while ($exhausted < $count && ! $pair->layers[$exhausted]->remainingQty->isPositive()) {
            $exhausted++;
        }

        if ($exhausted > 0 && ($exhausted >= 256 || $exhausted * 2 >= $count)) {
            $pair->layers = array_slice($pair->layers, $exhausted);
        }
    }
}
