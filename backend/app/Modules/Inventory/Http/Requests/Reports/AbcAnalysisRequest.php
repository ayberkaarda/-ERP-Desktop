<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Requests\Reports;

use Brick\Math\BigDecimal;

/**
 * date_from/date_to; `basis` consumption (default) | stock_value; class limits `a` (default 80) and
 * `b` (default 95) as cumulative percentages, 0 < a <= b <= 100.
 */
final class AbcAnalysisRequest extends RangeReportRequest
{
    /** @return array<string, mixed> */
    protected function reportRules(): array
    {
        return [
            ...$this->rangeRules(),
            'basis' => ['sometimes', 'nullable', 'in:consumption,stock_value'],
            'a' => ['sometimes', 'nullable', 'numeric', 'gt:0', 'max:100'],
            'b' => ['sometimes', 'nullable', 'numeric', 'gt:0', 'max:100'],
        ];
    }

    public function basis(): string
    {
        return $this->text('basis') ?? 'consumption';
    }

    public function limitA(): BigDecimal
    {
        $a = $this->validated('a');

        return BigDecimal::of(is_numeric($a) ? (string) $a : '80');
    }

    /** Never below a. */
    public function limitB(): BigDecimal
    {
        $b = $this->validated('b');
        $limit = BigDecimal::of(is_numeric($b) ? (string) $b : '95');

        return $limit->isLessThan($this->limitA()) ? $this->limitA() : $limit;
    }
}
