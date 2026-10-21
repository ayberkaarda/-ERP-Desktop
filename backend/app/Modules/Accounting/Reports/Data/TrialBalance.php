<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Data;

/**
 * Mizan: rows in code order down to the requested level, TDHP class subtotals and grand totals
 * (sums of the accounts' own bookings, so parents are not counted twice).
 */
final readonly class TrialBalance
{
    /**
     * @param  list<TrialBalanceRow>  $rows
     * @param  list<TrialBalanceGroup>  $groups
     */
    public function __construct(
        public ReportRange $range,
        public Source $source,
        public ?int $level,
        public bool $includeZero,
        public array $rows,
        public array $groups,
        public Amounts $totals,
        public ?ReportRange $previousRange,
        public ?Source $previousSource,
        public ?Amounts $previousTotals,
    ) {}

    /** Total debit equals total credit, for the movement and for the cumulative totals. */
    public function balanced(): bool
    {
        return $this->totals->debit->isEqualTo($this->totals->credit)
            && $this->totals->totalDebit()->isEqualTo($this->totals->totalCredit());
    }
}
