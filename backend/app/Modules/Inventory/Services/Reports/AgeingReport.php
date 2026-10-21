<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Services\Reports;

use App\Modules\Inventory\Data\Reports\ReportFilters;
use App\Modules\Inventory\Data\Reports\ReportTable;
use App\Modules\Inventory\Enums\ValuationMethod;
use App\Modules\Inventory\Support\InventorySettings;
use App\Modules\Inventory\Support\Stock;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use DateTimeImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Stock ageing as of a date, in the buckets 0-30, 31-60, 61-90 and over 90 days since receipt.
 *
 * Basis "layers" (FIFO companies, as_of today or later): the open FIFO cost layers with their
 * receipt date, remaining quantity and remaining value. Basis "receipts" (otherwise): the quantity on
 * hand at as_of is matched with the newest inbound movements first (the stock left is the stock
 * received last); inbound movements reversed by as_of do not count. Values: FIFO at the cost of each
 * receipt, moving average at the pair's average; the rounding remainder goes to the newest part, so
 * every row adds up to the stock value. Quantity no receipt explains falls into the oldest bucket.
 */
final class AgeingReport
{
    public const array BUCKETS = ['0_30' => [0, 30], '31_60' => [31, 60], '61_90' => [61, 90], 'over_90' => [91, null]];

    public function __construct(
        private readonly ReportQuery $query,
        private readonly PairGroups $groups,
        private readonly InventorySettings $settings,
    ) {}

    public function build(ReportFilters $f, string $asOf, string $groupBy, string $today): ReportTable
    {
        $method = $this->settings->valuationMethod();
        $useLayers = $method === ValuationMethod::Fifo && $asOf >= $today;
        $pairs = [];

        foreach ($this->query->pairTotals($f, $asOf) as $key => $pair) {
            if ($pair['quantity']->isPositive()) {
                $pairs[$key] = ['item_id' => $pair['item_id'], 'warehouse_id' => $pair['warehouse_id'], 'quantity' => $pair['quantity'], 'value' => $pair['value'], ...self::emptyBuckets()];
            }
        }

        $parts = $useLayers ? $this->layers($f) : $this->receipts($f, $asOf);
        $this->allocate($pairs, $parts, $asOf, $method);
        $fields = ['quantity', 'value'];

        foreach (array_keys(self::BUCKETS) as $bucket) {
            $fields[] = 'qty_'.$bucket;
            $fields[] = 'value_'.$bucket;
        }

        $rows = [];
        $totals = array_fill_keys(array_merge(['value'], array_map(static fn (string $b): string => 'value_'.$b, array_keys(self::BUCKETS))), BigDecimal::zero());

        foreach ($this->groups->group($f->companyId, array_values($pairs), $groupBy, $fields) as $group) {
            $row = [...$group['identity']];

            foreach ($fields as $field) {
                $value = $group['figures'][$field];
                $row[$field] = str_starts_with($field, 'value') ? ReportQuery::money($value) : ReportQuery::qty($value);

                if (isset($totals[$field])) {
                    $totals[$field] = $totals[$field]->plus($value);
                }
            }

            $rows[] = $row;
        }

        return new ReportTable($rows, [...StockStatusReport::IDENTITY, ...$fields], [
            'as_of' => $asOf,
            'group_by' => $groupBy,
            'basis' => $useLayers ? 'layers' : 'receipts',
            'method' => $method->value,
            'buckets' => array_map(static fn (array $b): array => ['from_days' => $b[0], 'to_days' => $b[1]], self::BUCKETS),
            'totals' => array_map(static fn (BigDecimal $v): string => ReportQuery::money($v), $totals),
        ]);
    }

    /**
     * @return array<string, BigDecimal>
     */
    private static function emptyBuckets(): array
    {
        $empty = [];

        foreach (array_keys(self::BUCKETS) as $bucket) {
            $empty['qty_'.$bucket] = BigDecimal::zero();
            $empty['value_'.$bucket] = BigDecimal::zero();
        }

        return $empty;
    }

    /**
     * Inbound parts newest first per pair: [key, date, quantity taken, value of that quantity or null].
     *
     * @return list<array{key: string, date: string, qty: BigDecimal, value: BigDecimal|null}>
     */
    private function receipts(ReportFilters $f, string $asOf): array
    {
        $inbound = $this->query->movements($f)
            ->where('m.direction', 'in')->where('m.occurred_at', '<=', $asOf)
            ->whereNotExists(fn ($q) => $q->from('stock_movements as r')->whereColumn('r.reverses_id', 'm.id')->where('r.occurred_at', '<=', $asOf))
            ->select(['m.item_id', 'm.warehouse_id', 'm.occurred_at', 'm.quantity', 'm.total_cost', 'm.seq'])
            ->selectRaw('sum(m.quantity) OVER (PARTITION BY m.item_id, m.warehouse_id ORDER BY m.occurred_at DESC, m.seq DESC) as cum');
        $balance = $this->query->movements($f)->where('m.occurred_at', '<=', $asOf)
            ->groupBy('m.item_id', 'm.warehouse_id')
            ->selectRaw('m.item_id, m.warehouse_id, sum('.ReportQuery::SIGNED_QTY.') as on_hand');

        $rows = DB::query()->fromSub($inbound, 'x')
            ->joinSub($balance, 'b', fn ($j) => $j->on('b.item_id', '=', 'x.item_id')->on('b.warehouse_id', '=', 'x.warehouse_id'))
            ->where('b.on_hand', '>', 0)
            ->whereRaw('x.cum - x.quantity < b.on_hand')
            ->orderBy('x.item_id')->orderBy('x.warehouse_id')->orderByDesc('x.occurred_at')->orderByDesc('x.seq')
            ->selectRaw('x.item_id, x.warehouse_id, x.occurred_at, x.quantity, x.total_cost, least(x.quantity, b.on_hand - (x.cum - x.quantity)) as take')
            ->get();
        $parts = [];

        foreach ($rows as $row) {
            $qty = Stock::dec((string) $row->quantity);
            $take = Stock::dec((string) $row->take);
            $total = Stock::dec((string) $row->total_cost);
            $parts[] = [
                'key' => $row->item_id.'|'.$row->warehouse_id,
                'date' => (string) $row->occurred_at,
                'qty' => $take,
                'value' => $take->isEqualTo($qty) ? $total : $total->multipliedBy($take)->dividedBy($qty, 4, RoundingMode::HalfEven),
            ];
        }

        return $parts;
    }

    /**
     * Open FIFO layers newest first per pair.
     *
     * @return list<array{key: string, date: string, qty: BigDecimal, value: BigDecimal|null}>
     */
    private function layers(ReportFilters $f): array
    {
        $query = DB::table('stock_cost_layers as c')->where('c.company_id', $f->companyId)->where('c.remaining_qty', '>', 0);

        if ($f->warehouseId !== null) {
            $query->where('c.warehouse_id', $f->warehouseId);
        }

        if ($f->itemId !== null) {
            $query->where('c.item_id', $f->itemId);
        }

        if ($f->needsItems()) {
            $query->join('items as i', fn ($j) => $j->on('i.id', '=', 'c.item_id')->where('i.company_id', '=', $f->companyId));
            $this->query->itemFilters($query, $f, 'i');
        }

        $rows = $query->orderBy('c.item_id')->orderBy('c.warehouse_id')->orderByDesc('c.received_at')->orderByDesc('c.id')
            ->get(['c.item_id', 'c.warehouse_id', 'c.received_at', 'c.remaining_qty', 'c.remaining_value']);

        return array_values(array_map(static fn ($row): array => [
            'key' => $row->item_id.'|'.$row->warehouse_id,
            'date' => (string) $row->received_at,
            'qty' => Stock::dec((string) $row->remaining_qty),
            'value' => Stock::dec((string) $row->remaining_value),
        ], $rows->all()));
    }

    /**
     * @param  array<string, array<string, mixed>>  $pairs
     * @param  list<array{key: string, date: string, qty: BigDecimal, value: BigDecimal|null}>  $parts  newest first per pair
     */
    private function allocate(array &$pairs, array $parts, string $asOf, ValuationMethod $method): void
    {
        $asOfDate = new DateTimeImmutable($asOf);
        /** @var array<string, array{qty: BigDecimal, value: BigDecimal}> $left */
        $left = [];
        $newest = [];

        foreach ($pairs as $key => $pair) {
            $qty = $pair['quantity'];
            $value = $pair['value'];
            $left[$key] = [
                'qty' => $qty instanceof BigDecimal ? $qty : BigDecimal::zero(),
                'value' => Stock::money($value instanceof BigDecimal ? $value : null),
            ];
        }

        foreach ($parts as $part) {
            $key = $part['key'];

            if (! isset($pairs[$key]) || ! $left[$key]['qty']->isPositive()) {
                continue;
            }

            $pair = $pairs[$key];
            $qty = $part['qty']->isGreaterThan($left[$key]['qty']) ? $left[$key]['qty'] : $part['qty'];
            $value = $method === ValuationMethod::Fifo && $part['value'] !== null
                ? Stock::money($part['value'])
                : Stock::money($qty->multipliedBy($pair['value'])->dividedBy($pair['quantity'], 8, RoundingMode::HalfEven));
            $bucket = self::bucket(max(0, (int) (new DateTimeImmutable($part['date']))->diff($asOfDate)->format('%r%a')));
            $pairs[$key]['qty_'.$bucket] = $pairs[$key]['qty_'.$bucket]->plus($qty);
            $pairs[$key]['value_'.$bucket] = $pairs[$key]['value_'.$bucket]->plus($value);
            $left[$key] = ['qty' => $left[$key]['qty']->minus($qty), 'value' => $left[$key]['value']->minus($value)];
            $newest[$key] ??= $bucket;
        }

        foreach ($pairs as $key => $pair) {
            // Quantity without a matching receipt is the oldest stock; the value remainder (rounding)
            // goes to the newest part so the buckets add up to the stock value.
            if ($left[$key]['qty']->isPositive()) {
                $pairs[$key]['qty_over_90'] = $pairs[$key]['qty_over_90']->plus($left[$key]['qty']);
                $pairs[$key]['value_over_90'] = $pairs[$key]['value_over_90']->plus($left[$key]['value']);
            } elseif (! $left[$key]['value']->isZero()) {
                $bucket = $newest[$key] ?? 'over_90';
                $pairs[$key]['value_'.$bucket] = $pairs[$key]['value_'.$bucket]->plus($left[$key]['value']);
            }
        }
    }

    private static function bucket(int $days): string
    {
        foreach (self::BUCKETS as $name => [$from, $to]) {
            if ($days >= $from && ($to === null || $days <= $to)) {
                return $name;
            }
        }

        return 'over_90';
    }
}
