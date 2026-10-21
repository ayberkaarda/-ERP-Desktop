<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Services;

use App\Core\Company\CompanyContext;
use App\Modules\Accounting\Contracts\PeriodGuard;
use App\Modules\Accounting\Enums\FiscalYearStatus;
use App\Modules\Accounting\Enums\PeriodStatus;
use App\Modules\Accounting\Exceptions\PeriodNotOpen;
use App\Modules\Accounting\Models\AccountingPeriod;
use App\Modules\Accounting\Models\FiscalYear;
use DateTimeInterface;
use Illuminate\Support\Str;

/**
 * Finds the period of a date and decides whether it accepts postings. The database repeats the
 * decision in a trigger under row locks; these checks give the friendly error first.
 */
final class Periods implements PeriodGuard
{
    public function __construct(private readonly CompanyContext $company) {}

    public function assertOpen(string $companyId, DateTimeInterface $date): void
    {
        $this->company->runAs($companyId, function () use ($date): void {
            $this->assertPostable($this->forDate($date));
        });
    }

    /**
     * The regular period (1..12) of the active company containing the date; period 13 only when
     * named explicitly through $periodId.
     *
     * @throws PeriodNotOpen
     */
    public function forDate(DateTimeInterface $date, ?string $periodId = null, bool $lock = false): AccountingPeriod
    {
        $day = $date->format('Y-m-d');
        $query = AccountingPeriod::query()->with('fiscalYear');

        if ($periodId !== null) {
            $query->whereKey(Str::isUuid($periodId) ? $periodId : null);
        } else {
            $query->where('number', '<', AccountingPeriod::ADJUSTMENT);
        }

        $period = $query->whereDate('start_date', '<=', $day)->whereDate('end_date', '>=', $day)
            ->when($lock, fn ($q) => $q->sharedLock())
            ->first();

        return $period ?? throw new PeriodNotOpen('no_period_for_date', ['date' => $day]);
    }

    /**
     * @throws PeriodNotOpen
     */
    public function assertPostable(AccountingPeriod $period, bool $allowSoftClosed = false): void
    {
        $year = $period->fiscalYear;
        $replace = ['period' => $period->number, 'year' => $year->code];

        if ($year->status !== FiscalYearStatus::Open) {
            throw new PeriodNotOpen('fiscal_year_closed', $replace);
        }

        if ($period->status === PeriodStatus::Closed || ($period->status === PeriodStatus::SoftClosed && ! $allowSoftClosed)) {
            throw new PeriodNotOpen($period->status === PeriodStatus::Closed ? 'period_closed' : 'period_soft_closed', $replace);
        }
    }

    /** The period that follows $period: the next number of its year, else period 1 of the next year. */
    public function next(AccountingPeriod $period): ?AccountingPeriod
    {
        $sameYear = AccountingPeriod::query()->where('fiscal_year_id', $period->fiscal_year_id)
            ->where('number', '>', $period->number)->where('number', '<', AccountingPeriod::ADJUSTMENT)
            ->orderBy('number')->first();

        if ($sameYear !== null) {
            return $sameYear;
        }

        $year = FiscalYear::query()->whereDate('start_date', '>', $period->end_date->format('Y-m-d'))->orderBy('start_date')->first();

        return $year === null ? null : AccountingPeriod::query()->where('fiscal_year_id', $year->id)->orderBy('number')->first();
    }
}
