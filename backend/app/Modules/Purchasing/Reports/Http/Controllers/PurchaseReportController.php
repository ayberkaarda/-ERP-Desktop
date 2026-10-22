<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Reports\Http\Controllers;

use App\Modules\Purchasing\Reports\Data\ReportTable;
use App\Modules\Purchasing\Reports\Http\Requests\PurchaseReportRequest;
use App\Modules\Purchasing\Reports\Http\Resources\ReportRowResource;
use App\Modules\Purchasing\Reports\Services\ItemDirectory;
use App\Modules\Purchasing\Reports\Services\OpenOrdersReport;
use App\Modules\Purchasing\Reports\Services\PriceVarianceReport;
use App\Modules\Purchasing\Reports\Services\PurchaseGroupReport;
use App\Modules\Purchasing\Reports\Services\PurchasesByPeriodReport;
use App\Modules\Purchasing\Reports\Services\ReceiptInvoiceReport;
use App\Modules\Purchasing\Reports\Services\ReturnRateReport;
use App\Modules\Purchasing\Reports\Services\RfqSavingsReport;
use App\Modules\Purchasing\Reports\Services\SupplierAgeingReport;
use App\Modules\Purchasing\Reports\Services\SupplierPerformanceReport;
use App\Modules\Purchasing\Reports\Support\ReadSnapshot;
use App\Modules\Purchasing\Support\Export;
use App\Modules\Purchasing\Support\PurchasingSettings;
use Illuminate\Contracts\Container\Container;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Purchasing reports under /purchase-reports/{report} (permission purchasing.reports.view, active
 * company only), each with an `/export?format=csv|xlsx` twin (at most purchasing.export_max_rows rows,
 * text cells guarded against formulas, numbers as exact decimal text). Amounts are in company
 * currency unless the column says otherwise; each report runs in one read-only snapshot. JSON:
 * `data` = the rows of the page; `meta` = report, currency, filters, report figures (totals,
 * by_currency, as_of/range) and pagination.
 */
final class PurchaseReportController
{
    // No constructor dependencies: the router keeps one controller instance across requests.

    public function show(PurchaseReportRequest $request, Container $app): AnonymousResourceCollection
    {
        $app->forgetInstance(ItemDirectory::class);
        $report = $request->report();
        [$table, $rows] = ReadSnapshot::run(function () use ($request, $app, $report): array {
            $table = $this->table($request, $app);
            $page = array_slice($table->rows, ($request->page() - 1) * $request->perPage(), $request->perPage());

            return [$table, $this->decorate($app, $report, $page)];
        });
        $total = count($table->rows);

        return ReportRowResource::collection($rows)->additional(['meta' => [
            'report' => $report,
            'currency' => $app->make(PurchasingSettings::class)->baseCurrency(),
            'filters' => $this->echo($request),
            ...$table->meta,
            'pagination' => [
                'current_page' => $request->page(),
                'per_page' => $request->perPage(),
                'total' => $total,
                'last_page' => max(1, (int) ceil($total / $request->perPage())),
            ],
        ]]);
    }

    public function export(PurchaseReportRequest $request, Container $app): StreamedResponse|BinaryFileResponse
    {
        $app->forgetInstance(ItemDirectory::class);
        $report = $request->report();
        $table = ReadSnapshot::run(function () use ($request, $app, $report): ReportTable {
            $table = $this->table($request, $app);
            Export::assertWithinCap(count($table->rows));

            return new ReportTable($this->decorate($app, $report, $table->rows), $table->columns, $table->meta);
        });
        $rows = array_map(static fn (array $row): array => array_map(static fn (string $column): string|int|null => $row[$column] ?? null, $table->columns), $table->rows);

        return Export::download('purchasing-'.$report, $request->exportFormat(), $table->columns, $rows);
    }

    private function table(PurchaseReportRequest $request, Container $app): ReportTable
    {
        $f = $request->filters();
        $by = $request->groupBy();

        return match ($request->report()) {
            'purchases-by-period' => $app->make(PurchasesByPeriodReport::class)->build($f, $request->period()),
            'by-supplier' => $app->make(PurchaseGroupReport::class)->build($f, 'supplier'),
            'by-item' => $app->make(PurchaseGroupReport::class)->build($f, 'item'),
            'top-suppliers' => $app->make(PurchaseGroupReport::class)->top($f, $request->limit()),
            'open-orders' => $app->make(OpenOrdersReport::class)->build($f, $by, $request->today()),
            'receipt-vs-invoice' => $app->make(ReceiptInvoiceReport::class)->build($f, $by),
            'supplier-ageing' => $app->make(SupplierAgeingReport::class)->build($f, $by),
            'price-variance' => $app->make(PriceVarianceReport::class)->build($f, $by),
            'supplier-performance' => $app->make(SupplierPerformanceReport::class)->build($f, $request->today()),
            'return-rate' => $app->make(ReturnRateReport::class)->build($f, $by),
            default => $app->make(RfqSavingsReport::class)->build($f, $by),
        };
    }

    /**
     * Codes and names of the rows being returned (Catalog/Parties contracts).
     *
     * @param  list<array<string, string|int|null>>  $rows
     * @return list<array<string, string|int|null>>
     */
    private function decorate(Container $app, string $report, array $rows): array
    {
        // Period rows carry no ids; top suppliers are decorated while they are built.
        if ($rows === [] || in_array($report, ['purchases-by-period', 'top-suppliers'], true)) {
            return $rows;
        }

        $directory = $app->make(ItemDirectory::class);

        if (array_key_exists('item_code', $rows[0])) {
            $rows = $directory->withItems($rows);
        }

        return array_key_exists('party_code', $rows[0]) ? $directory->withParties($rows) : $rows;
    }

    /** @return array<string, string|int|null> */
    private function echo(PurchaseReportRequest $request): array
    {
        $f = $request->filters();

        return array_filter([
            'date_from' => $f->dateFrom, 'date_to' => $f->dateTo, 'as_of' => $f->asOf, 'party_id' => $f->partyId, 'item_id' => $f->itemId,
            'category_id' => $f->categoryId, 'warehouse_id' => $f->warehouseId, 'currency_code' => $f->currencyCode,
        ], static fn (?string $v): bool => $v !== null);
    }
}
