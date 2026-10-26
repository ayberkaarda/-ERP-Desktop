<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Services\Reports;

use App\Modules\Inventory\Data\Reports\ReportFilters;
use App\Modules\Inventory\Data\Reports\ReportTable;
use App\Modules\Inventory\Support\Stock;
use Illuminate\Database\Query\Builder;

/**
 * Stok kartı (kartex) of one item, optionally in one warehouse: the opening quantity and value
 * before date_from, every movement of the range in date and posting order with quantity and value
 * in/out and the running quantity, value and average after it, the range totals and the closing
 * figures. The running figures come from window sums in the database, so they continue across pages.
 */
final class StockLedgerReport
{
    public const array COLUMNS = [
        'seq', 'occurred_at', 'movement_type', 'direction', 'warehouse_id', 'warehouse_code', 'location_id', 'lot_no', 'serial_no',
        'document_type', 'document_id', 'document_number', 'quantity_in', 'quantity_out', 'unit_cost', 'value_in', 'value_out',
        'balance_quantity', 'balance_value', 'balance_avg_cost', 'reverses_id', 'movement_id',
    ];

    public function __construct(private readonly ReportQuery $query) {}

    public function count(ReportFilters $f, string $from, string $to): int
    {
        return $this->range($f, $from, $to)->count();
    }

    /**
     * @param  int|null  $perPage  null: every line of the range
     */
    public function build(ReportFilters $f, string $from, string $to, int $page = 1, ?int $perPage = null): ReportTable
    {
        $openingRow = $this->query->movements($f)->where('m.occurred_at', '<', $from)
            ->selectRaw('coalesce(sum('.ReportQuery::SIGNED_QTY.'), 0) as quantity, coalesce(sum('.ReportQuery::SIGNED_VALUE.'), 0) as value')->first();
        $openingQty = Stock::dec(is_object($openingRow) ? (string) $openingRow->quantity : '0');
        $openingValue = Stock::dec(is_object($openingRow) ? (string) $openingRow->value : '0');

        $totalsRow = $this->range($f, $from, $to)->selectRaw(
            "count(*) as lines, coalesce(sum(CASE WHEN m.direction = 'in' THEN m.quantity END), 0) as qty_in, coalesce(sum(CASE WHEN m.direction = 'out' THEN m.quantity END), 0) as qty_out,
             coalesce(sum(CASE WHEN m.direction = 'in' THEN m.total_cost END), 0) as value_in, coalesce(sum(CASE WHEN m.direction = 'out' THEN m.total_cost END), 0) as value_out",
        )->first();
        $lines = is_object($totalsRow) ? (int) $totalsRow->lines : 0;
        $qtyIn = Stock::dec(is_object($totalsRow) ? (string) $totalsRow->qty_in : '0');
        $qtyOut = Stock::dec(is_object($totalsRow) ? (string) $totalsRow->qty_out : '0');
        $valueIn = Stock::dec(is_object($totalsRow) ? (string) $totalsRow->value_in : '0');
        $valueOut = Stock::dec(is_object($totalsRow) ? (string) $totalsRow->value_out : '0');

        $window = '(ORDER BY m.occurred_at, m.seq ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)';
        $query = $this->range($f, $from, $to)
            ->leftJoin('stock_lots as l', 'l.id', '=', 'm.lot_id')
            ->leftJoin('stock_serials as s', 's.id', '=', 'm.serial_id')
            ->leftJoin('stock_documents as d', fn ($j) => $j->on('d.id', '=', 'm.document_id')->where('d.company_id', '=', $f->companyId))
            ->select(['m.id', 'm.seq', 'm.occurred_at', 'm.movement_type', 'm.direction', 'm.warehouse_id', 'm.location_id', 'm.quantity', 'm.unit_cost',
                'm.total_cost', 'm.document_type', 'm.document_id', 'm.reverses_id', 'l.lot_no', 's.serial_no', 'd.number as document_number'])
            ->selectRaw('sum('.ReportQuery::SIGNED_QTY.') OVER '.$window.' as run_qty, sum('.ReportQuery::SIGNED_VALUE.') OVER '.$window.' as run_value')
            ->orderBy('m.occurred_at')->orderBy('m.seq');

        if ($perPage !== null) {
            $query->forPage($page, $perPage);
        }

        $movements = $query->get();
        $warehouses = $this->query->warehouses($f->companyId, array_values(array_map(static fn ($m): string => (string) $m->warehouse_id, $movements->all())));
        $rows = [];

        foreach ($movements as $m) {
            $in = $m->direction === 'in';
            $qty = Stock::qty((string) $m->quantity);
            $value = (string) Stock::money((string) $m->total_cost);
            $balanceQty = $openingQty->plus((string) $m->run_qty);
            $balanceValue = $openingValue->plus((string) $m->run_value);
            $rows[] = [
                'seq' => (int) $m->seq,
                'occurred_at' => (string) $m->occurred_at,
                'movement_type' => (string) $m->movement_type,
                'direction' => (string) $m->direction,
                'warehouse_id' => (string) $m->warehouse_id,
                'warehouse_code' => $warehouses[(string) $m->warehouse_id]['code'] ?? null,
                'location_id' => is_string($m->location_id) ? $m->location_id : null,
                'lot_no' => is_string($m->lot_no) ? $m->lot_no : null,
                'serial_no' => is_string($m->serial_no) ? $m->serial_no : null,
                'document_type' => (string) $m->document_type,
                'document_id' => (string) $m->document_id,
                'document_number' => is_string($m->document_number) ? $m->document_number : null,
                'quantity_in' => $in ? $qty : Stock::qty('0'),
                'quantity_out' => $in ? Stock::qty('0') : $qty,
                'unit_cost' => (string) Stock::dec((string) $m->unit_cost)->toScale(6),
                'value_in' => $in ? $value : '0.0000',
                'value_out' => $in ? '0.0000' : $value,
                'balance_quantity' => ReportQuery::qty($balanceQty),
                'balance_value' => ReportQuery::money($balanceValue),
                'balance_avg_cost' => ReportQuery::average($balanceValue, $balanceQty),
                'reverses_id' => is_string($m->reverses_id) ? $m->reverses_id : null,
                'movement_id' => (string) $m->id,
            ];
        }

        $closingQty = $openingQty->plus($qtyIn)->minus($qtyOut);
        $closingValue = $openingValue->plus($valueIn)->minus($valueOut);

        return new ReportTable($rows, self::COLUMNS, [
            'date_from' => $from,
            'date_to' => $to,
            'lines' => $lines,
            'opening' => ['quantity' => ReportQuery::qty($openingQty), 'value' => ReportQuery::money($openingValue), 'avg_cost' => ReportQuery::average($openingValue, $openingQty)],
            'totals' => [
                'quantity_in' => ReportQuery::qty($qtyIn), 'quantity_out' => ReportQuery::qty($qtyOut),
                'value_in' => ReportQuery::money($valueIn), 'value_out' => ReportQuery::money($valueOut),
            ],
            'closing' => ['quantity' => ReportQuery::qty($closingQty), 'value' => ReportQuery::money($closingValue), 'avg_cost' => ReportQuery::average($closingValue, $closingQty)],
        ]);
    }

    private function range(ReportFilters $f, string $from, string $to): Builder
    {
        return $this->query->movements($f)->whereBetween('m.occurred_at', [$from, $to]);
    }
}
