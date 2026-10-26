<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Data;

/**
 * What a report covers: one accounting period (period semantics: entries booked into it, opening =
 * periods ordered before it) or an inclusive date range (opening = entries dated before `from`).
 * A date range is aligned when no period lies partly inside it; account_balances can then answer it.
 */
final readonly class ReportRange
{
    public function __construct(
        public string $from,
        public string $to,
        public ?string $periodId,
        public ?int $periodNumber,
        public bool $aligned,
        public ?string $fiscalYearId,
    ) {}

    public function isPeriod(): bool
    {
        return $this->periodId !== null;
    }

    /** account_balances can answer this range exactly. */
    public function balancesUsable(): bool
    {
        return $this->isPeriod() || $this->aligned;
    }

    /**
     * @return array{date_from: string, date_to: string, period_id: string|null}
     */
    public function toArray(): array
    {
        return ['date_from' => $this->from, 'date_to' => $this->to, 'period_id' => $this->periodId];
    }
}
