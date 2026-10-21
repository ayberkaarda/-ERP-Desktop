<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Http\Requests;

/**
 * level: deepest account level shown (1 = classes; omitted = every level); include_zero: also rows
 * without any booking; compare_with_previous_year: adds the same range one year earlier.
 */
final class TrialBalanceRequest extends ReportRequest
{
    /** @return array<string, mixed> */
    protected function reportRules(): array
    {
        return [
            'level' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:32'],
            'include_zero' => ['sometimes', 'boolean'],
            'compare_with_previous_year' => ['sometimes', 'boolean'],
        ];
    }

    public function level(): ?int
    {
        $level = $this->validated('level');

        return is_numeric($level) ? (int) $level : null;
    }

    public function includeZero(): bool
    {
        return filter_var($this->validated('include_zero', false), FILTER_VALIDATE_BOOLEAN);
    }

    public function compare(): bool
    {
        return filter_var($this->validated('compare_with_previous_year', false), FILTER_VALIDATE_BOOLEAN);
    }
}
