<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Http\Requests;

use App\Modules\Accounting\Reports\Policies\ReportPolicy;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * Query parameters shared by the reports: either `period_id` or an inclusive `date_from`/`date_to`
 * range (Y-m-d); `format` (csv|xlsx) on the export routes. The permission is checked before
 * validation, so a caller without it only ever sees 403.
 */
abstract class ReportRequest extends FormRequest
{
    public const int DEFAULT_PER_PAGE = 100;

    public const int MAX_PER_PAGE = 500;

    public function authorize(): bool
    {
        return Gate::allows(ReportPolicy::ABILITY);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'period_id' => ['bail', 'nullable', 'required_without_all:date_from,date_to', 'uuid', 'prohibits:date_from,date_to'],
            'date_from' => ['bail', 'nullable', 'required_without:period_id', 'date_format:Y-m-d'],
            'date_to' => ['bail', 'nullable', 'required_without:period_id', 'date_format:Y-m-d', 'after_or_equal:date_from'],
            'format' => ['sometimes', 'in:csv,xlsx'],
            ...$this->reportRules(),
        ];
    }

    /** @return array<string, mixed> */
    abstract protected function reportRules(): array;

    /** @return array<string, mixed> */
    protected function paginationRules(): array
    {
        return [
            'page' => ['sometimes', 'integer', 'min:1', 'max:1000000'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.self::MAX_PER_PAGE],
        ];
    }

    public function periodId(): ?string
    {
        return $this->text('period_id');
    }

    public function dateFrom(): ?string
    {
        return $this->text('date_from');
    }

    public function dateTo(): ?string
    {
        return $this->text('date_to');
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

    protected function text(string $key): ?string
    {
        $value = $this->validated($key);

        return is_string($value) && $value !== '' ? $value : null;
    }
}
