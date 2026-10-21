<?php

declare(strict_types=1);

namespace App\Modules\Sales\Reports\Services;

use App\Modules\Sales\Enums\DeliveryStatus;
use App\Modules\Sales\Enums\ReturnStatus;
use App\Modules\Sales\Reports\Data\CostFact;
use App\Modules\Sales\Reports\Data\ReportFilters;
use App\Modules\Sales\Reports\Support\Num;
use Closure;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Streams the cost of goods sold in a range from the costs the stock postings recorded on the sales
 * documents (the same figures the stock movements and the COGS journal carry):
 * - a posted delivery line adds its cost_total on the delivery date (the stock issue date);
 * - a posted delivery cancelled later subtracts it on its stock reversal date (reversal_date: the
 *   date its stock issue and COGS entry were reversed, whenever the cancellation happened);
 * Every joined row is of the active company (line and header both).
 * - a received (or credited) return line subtracts its cost_total on the return date (return_in).
 */
final class CostFacts
{
    public function __construct(private readonly ItemDirectory $items) {}

    /**
     * @param  Closure(CostFact): void  $sink
     */
    public function each(ReportFilters $f, Closure $sink): void
    {
        $from = (string) $f->dateFrom;
        $to = (string) $f->dateTo;
        $deliveries = DB::table('sales_delivery_lines as l')->join('sales_deliveries as d', 'd.id', '=', 'l.document_id')
            ->where('d.company_id', $f->companyId)->where('l.company_id', $f->companyId)->whereNotNull('d.posted_at')
            ->where(fn (Builder $q) => $q->whereBetween('d.document_date', [$from, $to])
                ->orWhere(fn (Builder $r) => $r->where('d.status', DeliveryStatus::Cancelled->value)->whereBetween('d.reversal_date', [$from, $to])))
            ->tap(fn (Builder $q) => $this->filter($q, $f, 'd', 'd.warehouse_id'))
            ->orderBy('l.id')
            ->select(['l.id', 'l.item_id', 'l.base_quantity', 'l.cost_total', 'd.document_date', 'd.status', 'd.reversal_date', 'd.party_id', 'd.party_name', 'd.warehouse_id']);

        foreach ($this->items->stream($deliveries->lazyById(1000, 'l.id', 'id'), $f->categoryId !== null || $this->items->wantsCategories()) as $row) {
            if (! $this->matches($f, (string) $row->item_id)) {
                continue;
            }

            $cost = Num::dec($row->cost_total);
            $qty = Num::dec($row->base_quantity);
            $warehouse = is_string($row->warehouse_id) ? $row->warehouse_id : null;

            if ($f->inRange((string) $row->document_date)) {
                $sink(new CostFact((string) $row->document_date, 'delivery', (string) $row->party_id, (string) $row->party_name, (string) $row->item_id, $warehouse, $qty, $cost));
            }

            if ($row->status === DeliveryStatus::Cancelled->value && is_string($row->reversal_date)) {
                $date = $row->reversal_date;

                if ($f->inRange($date)) {
                    $sink(new CostFact($date, 'delivery_reversal', (string) $row->party_id, (string) $row->party_name, (string) $row->item_id, $warehouse, $qty->negated(), $cost->negated()));
                }
            }
        }

        $returns = DB::table('sales_return_lines as l')->join('sales_returns as r', 'r.id', '=', 'l.document_id')
            ->where('r.company_id', $f->companyId)->where('l.company_id', $f->companyId)
            ->whereIn('r.status', [ReturnStatus::Received->value, ReturnStatus::Credited->value])
            ->whereNotNull('l.cost_total')
            ->whereBetween('r.document_date', [$from, $to])
            ->tap(fn (Builder $q) => $this->filter($q, $f, 'r', DB::raw('coalesce(l.warehouse_id, r.warehouse_id)')))
            ->orderBy('l.id')
            ->select(['l.id', 'l.item_id', 'l.base_quantity', 'l.cost_total', 'l.warehouse_id as line_warehouse_id', 'r.document_date', 'r.party_id', 'r.party_name', 'r.warehouse_id']);

        foreach ($this->items->stream($returns->lazyById(1000, 'l.id', 'id'), $f->categoryId !== null || $this->items->wantsCategories()) as $row) {
            if (! $this->matches($f, (string) $row->item_id)) {
                continue;
            }

            $warehouse = $row->line_warehouse_id ?? $row->warehouse_id;
            $sink(new CostFact((string) $row->document_date, 'return', (string) $row->party_id, (string) $row->party_name, (string) $row->item_id,
                is_string($warehouse) ? $warehouse : null, Num::dec($row->base_quantity)->negated(), Num::dec($row->cost_total)->negated()));
        }
    }

    private function filter(Builder $q, ReportFilters $f, string $header, mixed $warehouse): void
    {
        $q->when($f->partyId !== null, fn (Builder $q) => $q->where("{$header}.party_id", $f->partyId))
            ->when($f->currencyCode !== null, fn (Builder $q) => $q->where("{$header}.currency_code", $f->currencyCode))
            ->when($f->itemId !== null, fn (Builder $q) => $q->where('l.item_id', $f->itemId))
            ->when($f->warehouseId !== null, fn (Builder $q) => $q->where($warehouse, $f->warehouseId));
    }

    private function matches(ReportFilters $f, string $itemId): bool
    {
        return $f->categoryId === null || $this->items->categoryOf($itemId) === $f->categoryId;
    }
}
