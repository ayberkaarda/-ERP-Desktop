<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Services;

use App\Modules\Accounting\Models\AccountingPeriod;
use App\Modules\Accounting\Models\FiscalYear;
use App\Modules\Accounting\Reports\Data\ReportRange;
use Illuminate\Support\Carbon;

/**
 * Turns report parameters into a ReportRange of the active company (models are company scoped, so a
 * period of another company is a 404).
 */
final class RangeResolver
{
    public function resolve(?string $periodId, ?string $from, ?string $to): ReportRange
    {
        if ($periodId !== null) {
            return $this->forPeriod(AccountingPeriod::query()->findOrFail($periodId));
        }

        return $this->forDates((string) $from, (string) $to);
    }

    public function forPeriod(AccountingPeriod $period): ReportRange
    {
        return new ReportRange(
            $period->start_date->format('Y-m-d'),
            $period->end_date->format('Y-m-d'),
            $period->id,
            $period->number,
            true,
            $period->fiscal_year_id,
        );
    }

    public function forDates(string $from, string $to): ReportRange
    {
        $partial = AccountingPeriod::query()
            ->whereDate('start_date', '<=', $to)
            ->whereDate('end_date', '>=', $from)
            ->where(fn ($q) => $q->whereDate('start_date', '<', $from)->orWhereDate('end_date', '>', $to))
            ->exists();
        $year = FiscalYear::query()->whereDate('start_date', '<=', $from)->whereDate('end_date', '>=', $from)->value('id');

        return new ReportRange($from, $to, null, null, ! $partial, is_string($year) ? $year : null);
    }

    /**
     * The same range one year earlier: the period with the same number in the preceding fiscal year,
     * or the dates moved back one year (29 February becomes 28 February).
     */
    public function previousYear(ReportRange $range): ReportRange
    {
        if ($range->isPeriod() && $range->fiscalYearId !== null) {
            $current = FiscalYear::query()->find($range->fiscalYearId);
            $previous = $current === null ? null : FiscalYear::query()
                ->whereDate('end_date', '<', $current->start_date->format('Y-m-d'))
                ->orderByDesc('end_date')->first();
            $period = $previous === null ? null : AccountingPeriod::query()
                ->where('fiscal_year_id', $previous->id)->where('number', $range->periodNumber)->first();

            if ($period !== null) {
                return $this->forPeriod($period);
            }
        }

        return $this->forDates(
            Carbon::parse($range->from)->subYearNoOverflow()->format('Y-m-d'),
            Carbon::parse($range->to)->subYearNoOverflow()->format('Y-m-d'),
        );
    }
}
