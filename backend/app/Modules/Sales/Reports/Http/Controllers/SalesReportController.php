<?php

declare(strict_types=1);

namespace App\Modules\Sales\Reports\Http\Controllers;

use App\Modules\Sales\Reports\Data\ReportTable;
use App\Modules\Sales\Reports\Http\Requests\SalesReportRequest;
use App\Modules\Sales\Reports\Http\Resources\ReportRowResource;
use App\Modules\Sales\Reports\Services\CustomerAgeingReport;
use App\Modules\Sales\Reports\Services\DeliveryInvoiceReport;
use App\Modules\Sales\Reports\Services\ItemDirectory;
use App\Modules\Sales\Reports\Services\MarginReport;
use App\Modules\Sales\Reports\Services\OpenOrdersReport;
use App\Modules\Sales\Reports\Services\QuoteConversionReport;
use App\Modules\Sales\Reports\Services\ReturnRateReport;
use App\Modules\Sales\Reports\Services\SalesByPeriodReport;
use App\Modules\Sales\Reports\Services\SalesGroupReport;
use App\Modules\Sales\Reports\Support\ReadSnapshot;
use App\Modules\Sales\Support\Export;
use App\Modules\Sales\Support\SalesSettings;
use Illuminate\Contracts\Container\Container;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Sales reports under /sales-reports/{report} (permission sales.reports.view, active company only),
 * each with an `/export?format=csv|xlsx` twin (at most sales.export_max_rows rows, text cells guarded
 * against formulas, numbers as exact decimal text). Amounts are in company currency unless the
 * column says otherwise; each report runs in one read-only snapshot. JSON: `data` = the rows of the
 * page; `meta` = currency, filters, report figures (totals, by_currency, as_of/range) and pagination.
 */
final class SalesReportController
{
    // No constructor dependencies: the router keeps one controller instance across requests.

    public function show(SalesReportRequest $request, Container $app): AnonymousResourceCollection
    {
        $app->forgetInstance(ItemDirectory::class);
        $report = $request->report();
        [$table, $rows] = ReadSnapshot::run(function () use ($request, $app, $report): array {
            $table = $this->table($request, $app);
            $page = array_slice($table->rows, ($request->page() - 1) * $request->perPage(), $request->perPage());

            return [$table, $this->decorate($app, $report, $request->groupBy(), $page)];
        });
        $total = count($table->rows);

        return ReportRowResource::collection($rows)->additional(['meta' => [
            'report' => $report,
            'currency' => $app->make(SalesSettings::class)->baseCurrency(),
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

    public function export(SalesReportRequest $request, Container $app): StreamedResponse|BinaryFileResponse
    {
        $app->forgetInstance(ItemDirectory::class);
        $report = $request->report();
        $table = ReadSnapshot::run(function () use ($request, $app, $report): ReportTable {
            $table = $this->table($request, $app);
            Export::assertWithinCap(count($table->rows));

            return new ReportTable($this->decorate($app, $report, $request->groupBy(), $table->rows), $table->columns, $table->meta);
        });
        $rows = array_map(static fn (array $row): array => array_map(static fn (string $column): string|int|null => $row[$column] ?? null, $table->columns), $table->rows);

        return Export::download('sales-'.$report, $request->exportFormat(), $table->columns, $rows);
    }

    private function table(SalesReportRequest $request, Container $app): ReportTable
    {
        $f = $request->filters();
        $by = $request->groupBy();

        return match ($request->report()) {
            'sales-by-period' => $app->make(SalesByPeriodReport::class)->build($f, $request->period()),
            'by-customer' => $app->make(SalesGroupReport::class)->build($f, 'customer'),
            'by-item' => $app->make(SalesGroupReport::class)->build($f, 'item'),
            'by-category' => $app->make(SalesGroupReport::class)->build($f, 'category'),
            'top-customers' => $app->make(SalesGroupReport::class)->top($f, $request->limit()),
            'margin' => $app->make(MarginReport::class)->build($f, $by),
            'return-rate' => $app->make(ReturnRateReport::class)->build($f, $by),
            'quote-conversion' => $app->make(QuoteConversionReport::class)->build($f, $by),
            'open-orders' => $app->make(OpenOrdersReport::class)->build($f, $by, $request->today()),
            'delivery-vs-invoice' => $app->make(DeliveryInvoiceReport::class)->build($f, $by),
            default => $app->make(CustomerAgeingReport::class)->build($f, $by),
        };
    }

    /**
     * Codes and names of the rows being returned (Catalog/Parties contracts).
     *
     * @param  list<array<string, string|int|null>>  $rows
     * @return list<array<string, string|int|null>>
     */
    private function decorate(Container $app, string $report, string $by, array $rows): array
    {
        return match ($report) {
            'by-customer' => $app->make(SalesGroupReport::class)->decorate($rows, 'customer'),
            'by-item' => $app->make(SalesGroupReport::class)->decorate($rows, 'item'),
            'margin' => $app->make(MarginReport::class)->decorate($rows, $by),
            'return-rate' => $app->make(ReturnRateReport::class)->decorate($rows, $by),
            'quote-conversion' => $app->make(QuoteConversionReport::class)->decorate($rows, $by),
            'open-orders' => $app->make(OpenOrdersReport::class)->decorate($rows, $by),
            'delivery-vs-invoice' => $app->make(DeliveryInvoiceReport::class)->decorate($rows, $by),
            'customer-ageing' => $app->make(CustomerAgeingReport::class)->decorate($rows, $by),
            default => $rows,
        };
    }

    /** @return array<string, string|int|null> */
    private function echo(SalesReportRequest $request): array
    {
        $f = $request->filters();

        return array_filter([
            'date_from' => $f->dateFrom, 'date_to' => $f->dateTo, 'as_of' => $f->asOf, 'party_id' => $f->partyId, 'item_id' => $f->itemId,
            'category_id' => $f->categoryId, 'warehouse_id' => $f->warehouseId, 'currency_code' => $f->currencyCode,
        ], static fn (?string $v): bool => $v !== null);
    }
}
