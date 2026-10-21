<?php

declare(strict_types=1);

namespace App\Modules\Sales\Reports\Http\Requests;

use App\Core\Company\CompanyContext;
use App\Modules\Sales\Reports\Data\ReportFilters;
use App\Modules\Sales\Reports\Policies\SalesReportPolicy;
use App\Modules\Sales\Reports\Services\CustomerAgeingReport;
use App\Modules\Sales\Reports\Services\DeliveryInvoiceReport;
use App\Modules\Sales\Reports\Services\MarginReport;
use App\Modules\Sales\Reports\Services\OpenOrdersReport;
use App\Modules\Sales\Reports\Services\QuoteConversionReport;
use App\Modules\Sales\Reports\Services\ReturnRateReport;
use App\Modules\Sales\Reports\Services\SalesByPeriodReport;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

/**
 * Query parameters of the sales reports (route default `report` names the report):
 * date_from/date_to (inclusive Y-m-d; range reports default to the year of date_to up to today,
 * open-orders and delivery-vs-invoice apply them only when given), as_of (Y-m-d, default today;
 * delivery-vs-invoice, customer-ageing), party_id, item_id, category_id, warehouse_id (uuid),
 * currency_code (ISO 4217), group_by (per report), period (sales-by-period: day|week|month, default
 * month), limit (top-customers, 1..100, default 10), page/per_page (max 500) and format (csv|xlsx) on
 * exports. The permission is checked before validation, so a caller without it only sees 403.
 */
final class SalesReportRequest extends FormRequest
{
    public const int DEFAULT_PER_PAGE = 100;

    public const int MAX_PER_PAGE = 500;

    /** report => [kind (range|open|as_of), groups, default group] */
    private const array REPORTS = [
        'sales-by-period' => ['range', [], null],
        'by-customer' => ['range', [], null],
        'by-item' => ['range', [], null],
        'by-category' => ['range', [], null],
        'top-customers' => ['range', [], null],
        'margin' => ['range', MarginReport::GROUPS, 'item'],
        'return-rate' => ['range', ReturnRateReport::GROUPS, 'item'],
        'quote-conversion' => ['range', QuoteConversionReport::GROUPS, 'none'],
        'open-orders' => ['open', OpenOrdersReport::GROUPS, 'line'],
        'delivery-vs-invoice' => ['as_of', DeliveryInvoiceReport::GROUPS, 'line'],
        'customer-ageing' => ['as_of', CustomerAgeingReport::GROUPS, 'customer'],
    ];

    /** @return list<string> */
    public static function reports(): array
    {
        return array_keys(self::REPORTS);
    }

    public function authorize(): bool
    {
        return Gate::allows(SalesReportPolicy::ABILITY);
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
            'period' => ['sometimes', 'nullable', Rule::in(SalesByPeriodReport::PERIODS)],
            'limit' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:100'],
            'format' => ['sometimes', 'in:csv,xlsx'],
            'page' => ['sometimes', 'integer', 'min:1', 'max:1000000'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.self::MAX_PER_PAGE],
        ];
    }

    public function report(): string
    {
        $report = $this->route()?->defaults['report'] ?? null;

        return is_string($report) && isset(self::REPORTS[$report]) ? $report : 'sales-by-period';
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
