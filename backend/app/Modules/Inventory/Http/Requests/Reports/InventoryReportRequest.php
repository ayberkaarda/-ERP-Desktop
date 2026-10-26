<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Requests\Reports;

use App\Core\Company\CompanyContext;
use App\Modules\Inventory\Data\Reports\ReportFilters;
use App\Modules\Inventory\Policies\InventoryReportPolicy;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Gate;

/**
 * Query parameters shared by the stock reports: optional `warehouse_id`, `category_id` (includes
 * sub-categories), `item_id` and `q` (item code/name); `page`/`per_page` (max 500) on the JSON
 * routes and `format` (csv|xlsx) on the export routes. The permission is checked before validation,
 * so a caller without it only ever sees 403.
 */
abstract class InventoryReportRequest extends FormRequest
{
    public const int DEFAULT_PER_PAGE = 100;

    public const int MAX_PER_PAGE = 500;

    public function authorize(): bool
    {
        return Gate::allows(InventoryReportPolicy::ABILITY);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'warehouse_id' => ['sometimes', 'nullable', 'uuid'],
            'category_id' => ['sometimes', 'nullable', 'uuid'],
            'item_id' => ['sometimes', 'nullable', 'uuid'],
            'q' => ['sometimes', 'nullable', 'string', 'max:200'],
            'format' => ['sometimes', 'in:csv,xlsx'],
            'page' => ['sometimes', 'integer', 'min:1', 'max:1000000'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.self::MAX_PER_PAGE],
            ...$this->reportRules(),
        ];
    }

    /** @return array<string, mixed> */
    abstract protected function reportRules(): array;

    public function filters(): ReportFilters
    {
        $q = $this->text('q');
        $q = $q === null ? null : trim($q);

        return new ReportFilters(
            app(CompanyContext::class)->id(),
            $this->text('warehouse_id'),
            $this->text('category_id'),
            $this->text('item_id'),
            $q === '' ? null : $q,
        );
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

    protected function text(string $key): ?string
    {
        $value = $this->validated($key);

        return is_string($value) && $value !== '' ? $value : null;
    }

    protected function flag(string $key, bool $default): bool
    {
        $value = $this->validated($key);

        return $value === null ? $default : in_array($value, [true, 1, '1', 'true'], true);
    }

    /** @return list<string> */
    protected static function boolRule(): array
    {
        return ['sometimes', 'nullable', 'in:0,1,true,false'];
    }
}
