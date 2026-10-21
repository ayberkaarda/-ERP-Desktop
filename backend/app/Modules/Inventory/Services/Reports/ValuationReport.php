<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Services\Reports;

use App\Modules\Inventory\Data\Reports\ReportFilters;
use App\Modules\Inventory\Data\Reports\ReportTable;
use App\Modules\Inventory\Enums\ValuationMethod;
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
 * ones are re-costed (moving average, or FIFO layers oldest first). A simulation is a what-if figure
 * and does not reconcile with the journal.
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
            } else {
                $valuator->outbound($pair, $qty);
            }

            // Fully consumed layers are of no further use in a replay.
            $pair->layers = array_values(array_filter($pair->layers, static fn ($l): bool => $l->remainingQty->isPositive()));
        }

        return array_values(array_map(static fn (Pair $p): array => [
            'item_id' => $p->itemId, 'warehouse_id' => $p->warehouseId, 'quantity' => $p->quantity, 'value' => $p->value,
        ], $pairs));
    }
}
