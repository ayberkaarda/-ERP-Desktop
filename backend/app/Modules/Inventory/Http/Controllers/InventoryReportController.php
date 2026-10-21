<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Controllers;

use App\Modules\Inventory\Data\Reports\ReportTable;
use App\Modules\Inventory\Http\Requests\Reports\AbcAnalysisRequest;
use App\Modules\Inventory\Http\Requests\Reports\AgeingRequest;
use App\Modules\Inventory\Http\Requests\Reports\ExpiringLotsRequest;
use App\Modules\Inventory\Http\Requests\Reports\InventoryReportRequest;
use App\Modules\Inventory\Http\Requests\Reports\MovementSummaryRequest;
use App\Modules\Inventory\Http\Requests\Reports\StockLedgerRequest;
use App\Modules\Inventory\Http\Requests\Reports\StockStatusRequest;
use App\Modules\Inventory\Http\Requests\Reports\TurnoverRequest;
use App\Modules\Inventory\Http\Requests\Reports\ValuationRequest;
use App\Modules\Inventory\Http\Resources\Reports\AbcRowResource;
use App\Modules\Inventory\Http\Resources\Reports\AgeingRowResource;
use App\Modules\Inventory\Http\Resources\Reports\ExpiringLotResource;
use App\Modules\Inventory\Http\Resources\Reports\MovementSummaryRowResource;
use App\Modules\Inventory\Http\Resources\Reports\ReportRowResource;
use App\Modules\Inventory\Http\Resources\Reports\StockLedgerLineResource;
use App\Modules\Inventory\Http\Resources\Reports\StockStatusRowResource;
use App\Modules\Inventory\Http\Resources\Reports\TurnoverRowResource;
use App\Modules\Inventory\Models\StockMovement;
use App\Modules\Inventory\Services\Reports\AbcAnalysisReport;
use App\Modules\Inventory\Services\Reports\AgeingReport;
use App\Modules\Inventory\Services\Reports\ExpiringLotsReport;
use App\Modules\Inventory\Services\Reports\MovementSummaryReport;
use App\Modules\Inventory\Services\Reports\ReportQuery;
use App\Modules\Inventory\Services\Reports\StockLedgerReport;
use App\Modules\Inventory\Services\Reports\StockStatusReport;
use App\Modules\Inventory\Services\Reports\TurnoverReport;
use App\Modules\Inventory\Services\Reports\ValuationReport;
use App\Modules\Inventory\Support\Export;
use App\Modules\Inventory\Support\Messages;
use App\Modules\Inventory\Support\ReadSnapshot;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Stock reports (permission inventory.reports.view, active company only), each with an
 * `/export?format=csv|xlsx` twin (at most inventory.export_max_rows rows, text cells guarded
 * against formulas, numbers as exact decimal text). Figures are rebuilt from the append-only
 * movements; each report runs in one read-only snapshot. JSON responses: `data` (the rows of the
 * page) and `meta` (report figures such as as_of/range, basis and totals, plus pagination).
 */
final class InventoryReportController
{
    // No constructor dependencies: the router keeps one controller instance across requests.

    /**
     * Stock status as of a date.
     *
     * Quantity, average cost and value per item x warehouse (or item, warehouse, category) rebuilt
     * from the movements dated on or before `as_of`; meta.totals.value is the stock value.
     */
    public function stockStatus(StockStatusRequest $request, StockStatusReport $report): AnonymousResourceCollection
    {
        $table = ReadSnapshot::run(fn (): ReportTable => $report->build($request->filters(), $request->asOf(), $request->groupBy(), $request->includeZero()));

        return $this->paged($table, $request, StockStatusRowResource::class);
    }

    public function stockStatusExport(StockStatusRequest $request, StockStatusReport $report): StreamedResponse|BinaryFileResponse
    {
        $table = ReadSnapshot::run(fn (): ReportTable => $report->build($request->filters(), $request->asOf(), $request->groupBy(), $request->includeZero()));

        return $this->download('stock-status', $request, $table);
    }

    /**
     * Stok kartı (kartex) of one item.
     *
     * Opening figures before `date_from`, the movements of the range with quantity/value in and out
     * and the running quantity, value and average (continuing across pages), totals and closing.
     */
    public function stockLedger(StockLedgerRequest $request, StockLedgerReport $report, ReportQuery $query): AnonymousResourceCollection
    {
        [$item, $table] = ReadSnapshot::run(function () use ($request, $report, $query): array {
            $item = $this->item($request, $query);

            return [$item, $report->build($request->filters(), $request->dateFrom(), $request->dateTo(), $request->page(), $request->perPage())];
        });
        $total = is_int($table->meta['lines'] ?? null) ? $table->meta['lines'] : 0;

        return StockLedgerLineResource::collection($table->rows)->additional(['meta' => [
            ...$table->meta,
            'item' => $item,
            'warehouse_id' => $request->filters()->warehouseId,
            'pagination' => self::pagination($request->page(), $request->perPage(), $total),
        ]]);
    }

    public function stockLedgerExport(StockLedgerRequest $request, StockLedgerReport $report, ReportQuery $query): StreamedResponse|BinaryFileResponse
    {
        $table = ReadSnapshot::run(function () use ($request, $report, $query): ReportTable {
            $this->item($request, $query);
            $f = $request->filters();
            Export::assertWithinCap($report->count($f, $request->dateFrom(), $request->dateTo()) + 2);

            return $report->build($f, $request->dateFrom(), $request->dateTo());
        });
        /** @var array{quantity: string, value: string, avg_cost: string} $opening */
        $opening = $table->meta['opening'];
        /** @var array{quantity: string, value: string, avg_cost: string} $closing */
        $closing = $table->meta['closing'];
        /** @var array{quantity_in: string, quantity_out: string, value_in: string, value_out: string} $totals */
        $totals = $table->meta['totals'];
        $blank = array_fill_keys(StockLedgerReport::COLUMNS, null);
        $rows = [
            [...$blank, 'movement_type' => Messages::get('report_opening'), 'balance_quantity' => $opening['quantity'], 'balance_value' => $opening['value'], 'balance_avg_cost' => $opening['avg_cost']],
            ...$table->rows,
            [...$blank, 'movement_type' => Messages::get('report_closing'), 'quantity_in' => $totals['quantity_in'], 'quantity_out' => $totals['quantity_out'],
                'value_in' => $totals['value_in'], 'value_out' => $totals['value_out'],
                'balance_quantity' => $closing['quantity'], 'balance_value' => $closing['value'], 'balance_avg_cost' => $closing['avg_cost']],
        ];

        return $this->download('stock-ledger', $request, new ReportTable($rows, $table->columns, $table->meta), capped: true);
    }

    /**
     * Stock valuation as of a date.
     *
     * With the company method (default) the booked values that the stock account shows (basis
     * booked); with the other `method` a replay of the movements (basis simulated, a what-if figure).
     */
    public function valuation(ValuationRequest $request, ValuationReport $report): AnonymousResourceCollection
    {
        $table = ReadSnapshot::run(fn (): ReportTable => $report->build($request->filters(), $request->asOf(), $request->valuationMethod(), $request->groupBy(), $request->includeZero()));

        return $this->paged($table, $request, StockStatusRowResource::class);
    }

    public function valuationExport(ValuationRequest $request, ValuationReport $report): StreamedResponse|BinaryFileResponse
    {
        $table = ReadSnapshot::run(fn (): ReportTable => $report->build($request->filters(), $request->asOf(), $request->valuationMethod(), $request->groupBy(), $request->includeZero()));

        return $this->download('stock-valuation', $request, $table);
    }

    /**
     * Stock ageing as of a date.
     *
     * Quantity and value on hand in the buckets 0-30, 31-60, 61-90 and over 90 days since receipt
     * (FIFO layers, or the newest receipts covering the stock).
     */
    public function ageing(AgeingRequest $request, AgeingReport $report): AnonymousResourceCollection
    {
        $table = ReadSnapshot::run(fn (): ReportTable => $report->build($request->filters(), $request->asOf(), $request->groupBy()));

        return $this->paged($table, $request, AgeingRowResource::class);
    }

    public function ageingExport(AgeingRequest $request, AgeingReport $report): StreamedResponse|BinaryFileResponse
    {
        $table = ReadSnapshot::run(fn (): ReportTable => $report->build($request->filters(), $request->asOf(), $request->groupBy()));

        return $this->download('stock-ageing', $request, $table);
    }

    /**
     * Lots expiring within `days` days (already expired ones included by default), soonest first.
     */
    public function expiringLots(ExpiringLotsRequest $request, ExpiringLotsReport $report): AnonymousResourceCollection
    {
        $table = ReadSnapshot::run(fn (): ReportTable => $report->build($request->filters(), $request->today(), $request->days(), $request->includeExpired()));

        return $this->paged($table, $request, ExpiringLotResource::class);
    }

    public function expiringLotsExport(ExpiringLotsRequest $request, ExpiringLotsReport $report): StreamedResponse|BinaryFileResponse
    {
        $table = ReadSnapshot::run(fn (): ReportTable => $report->build($request->filters(), $request->today(), $request->days(), $request->includeExpired()));

        return $this->download('expiring-lots', $request, $table);
    }

    /**
     * ABC analysis of the items by consumption value in the range (or stock value at date_to).
     */
    public function abcAnalysis(AbcAnalysisRequest $request, AbcAnalysisReport $report): AnonymousResourceCollection
    {
        $table = ReadSnapshot::run(fn (): ReportTable => $report->build($request->filters(), $request->dateFrom(), $request->dateTo(), $request->basis(), $request->limitA(), $request->limitB()));

        return $this->paged($table, $request, AbcRowResource::class);
    }

    public function abcAnalysisExport(AbcAnalysisRequest $request, AbcAnalysisReport $report): StreamedResponse|BinaryFileResponse
    {
        $table = ReadSnapshot::run(fn (): ReportTable => $report->build($request->filters(), $request->dateFrom(), $request->dateTo(), $request->basis(), $request->limitA(), $request->limitB()));

        return $this->download('abc-analysis', $request, $table);
    }

    /**
     * Stock turnover over the range: consumption / average stock value and days on hand.
     */
    public function turnover(TurnoverRequest $request, TurnoverReport $report): AnonymousResourceCollection
    {
        $table = ReadSnapshot::run(fn (): ReportTable => $report->build($request->filters(), $request->dateFrom(), $request->dateTo(), $request->groupBy()));

        return $this->paged($table, $request, TurnoverRowResource::class);
    }

    public function turnoverExport(TurnoverRequest $request, TurnoverReport $report): StreamedResponse|BinaryFileResponse
    {
        $table = ReadSnapshot::run(fn (): ReportTable => $report->build($request->filters(), $request->dateFrom(), $request->dateTo(), $request->groupBy()));

        return $this->download('stock-turnover', $request, $table);
    }

    /**
     * Movement summary over the range: opening, in, out and closing per group; meta.by_type.
     */
    public function movementSummary(MovementSummaryRequest $request, MovementSummaryReport $report): AnonymousResourceCollection
    {
        $table = ReadSnapshot::run(fn (): ReportTable => $report->build($request->filters(), $request->dateFrom(), $request->dateTo(), $request->groupBy(), $request->includeZero()));

        return $this->paged($table, $request, MovementSummaryRowResource::class);
    }

    public function movementSummaryExport(MovementSummaryRequest $request, MovementSummaryReport $report): StreamedResponse|BinaryFileResponse
    {
        $table = ReadSnapshot::run(fn (): ReportTable => $report->build($request->filters(), $request->dateFrom(), $request->dateTo(), $request->groupBy(), $request->includeZero()));

        return $this->download('movement-summary', $request, $table);
    }

    /**
     * The item of a kartex (404 unless it belongs to the active company).
     *
     * @return array{id: string, code: string, name: string, base_unit_id: string}
     */
    private function item(StockLedgerRequest $request, ReportQuery $query): array
    {
        $id = $request->itemId();
        $item = $query->items($request->filters()->companyId, [$id])[$id] ?? throw (new ModelNotFoundException)->setModel(StockMovement::class, [$id]);

        return ['id' => $id, 'code' => $item['code'], 'name' => $item['name'], 'base_unit_id' => $item['base_unit_id']];
    }

    /**
     * @param  class-string<ReportRowResource>  $resource
     */
    private function paged(ReportTable $table, InventoryReportRequest $request, string $resource): AnonymousResourceCollection
    {
        $page = $request->page();
        $perPage = $request->perPage();

        return $resource::collection(array_slice($table->rows, ($page - 1) * $perPage, $perPage))->additional(['meta' => [
            ...$table->meta,
            'pagination' => self::pagination($page, $perPage, count($table->rows)),
        ]]);
    }

    /**
     * @return array{current_page: int, per_page: int, total: int, last_page: int}
     */
    private static function pagination(int $page, int $perPage, int $total): array
    {
        return ['current_page' => $page, 'per_page' => $perPage, 'total' => $total, 'last_page' => max(1, (int) ceil($total / $perPage))];
    }

    private function download(string $name, InventoryReportRequest $request, ReportTable $table, bool $capped = false): StreamedResponse|BinaryFileResponse
    {
        if (! $capped) {
            Export::assertWithinCap(count($table->rows));
        }

        $rows = [];

        foreach ($table->rows as $row) {
            $rows[] = array_map(static function (string $column) use ($row): ?string {
                $value = $row[$column] ?? null;

                return match (true) {
                    is_bool($value) => $value ? 'true' : 'false',
                    $value === null => null,
                    default => (string) $value,
                };
            }, $table->columns);
        }

        return Export::download($name, $request->exportFormat(), $table->columns, $rows);
    }
}
