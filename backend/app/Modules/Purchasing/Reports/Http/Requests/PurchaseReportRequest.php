<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Reports\Http\Requests;

use App\Core\Company\CompanyContext;
use App\Modules\Purchasing\Reports\Data\ReportFilters;
use App\Modules\Purchasing\Reports\Policies\PurchaseReportPolicy;
use App\Modules\Purchasing\Reports\Services\OpenOrdersReport;
use App\Modules\Purchasing\Reports\Services\PriceVarianceReport;
use App\Modules\Purchasing\Reports\Services\PurchasesByPeriodReport;
use App\Modules\Purchasing\Reports\Services\ReceiptInvoiceReport;
use App\Modules\Purchasing\Reports\Services\ReturnRateReport;
use App\Modules\Purchasing\Reports\Services\RfqSavingsReport;
use App\Modules\Purchasing\Reports\Services\SupplierAgeingReport;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

/**
 * Query parameters of the purchasing reports (route default `report` names the report):
 * date_from/date_to (inclusive Y-m-d; range reports default to the year of date_to up to today,
 * open-orders and receipt-vs-invoice apply them only when given), as_of (Y-m-d, default today;
 * receipt-vs-invoice, supplier-ageing), party_id, item_id, category_id, warehouse_id (uuid),
 * currency_code (ISO 4217), group_by (per report, others reject it), period (purchases-by-period:
 * day|week|month, default month), limit (top-suppliers, 1..100, default 10), page/per_page (max 500)
 * and format (csv|xlsx) on exports. The permission is checked before validation, so a caller
 * without it only sees 403.
 */
final class PurchaseReportRequest extends FormRequest
{
    public const int DEFAULT_PER_PAGE = 100;

    public const int MAX_PER_PAGE = 500;

    /** report => [kind (range|open|as_of), groups, default group] */
    private const array REPORTS = [
        'purchases-by-period' => ['range', [], null],
        'by-supplier' => ['range', [], null],
        'by-item' => ['range', [], null],
        'top-suppliers' => ['range', [], null],
        'open-orders' => ['open', OpenOrdersReport::GROUPS, 'line'],
        'receipt-vs-invoice' => ['as_of', ReceiptInvoiceReport::GROUPS, 'line'],
        'supplier-ageing' => ['as_of', SupplierAgeingReport::GROUPS, 'supplier'],
        'price-variance' => ['range', PriceVarianceReport::GROUPS, 'line'],
        'supplier-performance' => ['range', [], null],
        'return-rate' => ['range', ReturnRateReport::GROUPS, 'supplier'],
        'rfq-savings' => ['range', RfqSavingsReport::GROUPS, 'rfq'],
    ];

    /** @return list<string> */
    public static function reports(): array
    {
        return array_keys(self::REPORTS);
    }

    public function authorize(): bool
    {
        return Gate::allows(PurchaseReportPolicy::ABILITY);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $groups = self::REPORTS[$this->report()][1];

        return [
            'date_from' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'date_to' => ['sometimes', 'nullable', 'date_format:Y-m-d', 'after_or_equal:date_from'],
            'as_of' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'party_id' => ['sometimes', 'nullable', 'uuid'],
            'item_id' => ['sometimes', 'nullable', 'uuid'],
            'category_id' => ['sometimes', 'nullable', 'uuid'],
            'warehouse_id' => ['sometimes', 'nullable', 'uuid'],
            'currency_code' => ['sometimes', 'nullable', 'string', 'regex:/^[A-Z]{3}$/'],
            'group_by' => ['sometimes', 'nullable', Rule::in($groups)],
            'period' => ['sometimes', 'nullable', Rule::in(PurchasesByPeriodReport::PERIODS)],
            'limit' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:100'],
            'format' => ['sometimes', 'in:csv,xlsx'],
            'page' => ['sometimes', 'integer', 'min:1', 'max:1000000'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.self::MAX_PER_PAGE],
        ];
    }

    public function report(): string
    {
        $report = $this->route()?->defaults['report'] ?? null;

        return is_string($report) && isset(self::REPORTS[$report]) ? $report : 'purchases-by-period';
    }

    public function filters(): ReportFilters
    {
        $kind = self::REPORTS[$this->report()][0];
        [$from, $to] = $kind === 'range' ? [$this->dateFrom(), $this->dateTo()] : [$this->text('date_from'), $this->text('date_to')];

        return new ReportFilters(
            app(CompanyContext::class)->id(),
            $from,
            $to,
            $kind === 'as_of' ? ($this->text('as_of') ?? $this->today()) : null,
            $this->text('party_id'),
            $this->text('item_id'),
            $this->text('category_id'),
            $this->text('warehouse_id'),
            $this->text('currency_code'),
        );
    }

    public function groupBy(): string
    {
        return $this->text('group_by') ?? (string) self::REPORTS[$this->report()][2];
    }

    public function period(): string
    {
        return $this->text('period') ?? 'month';
    }

    public function limit(): int
    {
        $limit = $this->validated('limit');

        return is_numeric($limit) ? (int) $limit : 10;
    }

    public function exportFormat(): string
    {
        return $this->text('format') ?? 'csv';
    }

    public function page(): int
    {
        $page = $this->validated('page');

        return is_numeric($page) ? (int) $page : 1;
    }

    public function perPage(): int
    {
        $size = $this->validated('per_page');

        return is_numeric($size) ? (int) $size : self::DEFAULT_PER_PAGE;
    }

    public function today(): string
    {
        return Carbon::today()->format('Y-m-d');
    }

    private function dateTo(): string
    {
        return $this->text('date_to') ?? $this->today();
    }

    private function dateFrom(): string
    {
        $from = $this->text('date_from') ?? substr($this->dateTo(), 0, 4).'-01-01';

        return $from > $this->dateTo() ? $this->dateTo() : $from;
    }

    private function text(string $key): ?string
    {
        $value = $this->validated($key);

        return is_string($value) && $value !== '' ? $value : null;
    }
}
