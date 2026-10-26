<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Services;

use App\Modules\Accounting\Models\AccountingPeriod;
use App\Modules\Accounting\Models\FiscalYear;
use App\Modules\Accounting\Models\JournalEntry;
use App\Modules\Accounting\Support\Ledger;
use App\Modules\Accounting\Support\Messages;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Fiscal years and their periods: one period per calendar month (the first and last may be
 * partial for a short year), at most 12, plus an optional zero-length period 13 on the last day.
 */
final class FiscalCalendar
{
    public const string TIMEZONE = 'Europe/Istanbul';

    /**
     * @param  array{code: string, name?: string|null, start_date: string, end_date?: string|null, adjustment_period?: bool}  $data
     */
    public function create(array $data): FiscalYear
    {
        $start = CarbonImmutable::parse($data['start_date']);
        $end = isset($data['end_date']) ? CarbonImmutable::parse($data['end_date']) : $start->addYear()->subDay();

        return $this->guarded(function () use ($data, $start, $end): FiscalYear {
            Ledger::lock('calendar');
            $this->assertNoOverlap($start, $end, null);

            $year = new FiscalYear([
                'code' => $data['code'],
                'name' => ($data['name'] ?? null) ?: $data['code'],
                'start_date' => $start->format('Y-m-d'),
                'end_date' => $end->format('Y-m-d'),
            ]);
            $year->save();
            $this->generatePeriods($year, $start, $end, (bool) ($data['adjustment_period'] ?? false));

            return $year->load('periods');
        });
    }

    /**
     * Name always; dates only while the year has no journal entries at all (periods are regenerated).
     *
     * @param  array{name?: string, start_date?: string, end_date?: string}  $data
     */
    public function update(FiscalYear $year, array $data, int $version): FiscalYear
    {
        return $this->guarded(function () use ($year, $data, $version): FiscalYear {
            Ledger::lock('calendar');
            $locked = FiscalYear::query()->whereKey($year->id)->lockForUpdate()->firstOrFail();
            $locked->assertVersion($version);

            if (isset($data['name'])) {
                $locked->name = $data['name'];
            }

            $start = CarbonImmutable::parse($data['start_date'] ?? $locked->start_date->format('Y-m-d'));
            $end = CarbonImmutable::parse($data['end_date'] ?? $locked->end_date->format('Y-m-d'));
            $datesChanged = $start->format('Y-m-d') !== $locked->start_date->format('Y-m-d') || $end->format('Y-m-d') !== $locked->end_date->format('Y-m-d');

            if ($datesChanged) {
                if (! $locked->isOpen() || JournalEntry::query()->where('fiscal_year_id', $locked->id)->exists()) {
                    Messages::fail('start_date', 'fiscal_year_dates_locked');
                }

                $this->assertNoOverlap($start, $end, $locked->id);
                $adjustment = AccountingPeriod::query()->where('fiscal_year_id', $locked->id)->where('number', AccountingPeriod::ADJUSTMENT)->exists();
                AccountingPeriod::query()->where('fiscal_year_id', $locked->id)->delete();
                $locked->start_date = Carbon::parse($start->format('Y-m-d'));
                $locked->end_date = Carbon::parse($end->format('Y-m-d'));
                $locked->save();
                $this->generatePeriods($locked, $start, $end, $adjustment);
            } else {
                $locked->save();
            }

            return $locked->load('periods');
        });
    }

    /**
     * The calendar year containing $today (company time zone), created with 12 open periods unless
     * a year already covers any part of it. Idempotent.
     */
    public function ensureCurrent(?CarbonImmutable $today = null): ?FiscalYear
    {
        $today ??= CarbonImmutable::now(self::TIMEZONE);
        $start = $today->startOfYear();
        $end = $today->endOfYear()->startOfDay();

        return Ledger::transaction(function () use ($start, $end): ?FiscalYear {
            Ledger::lock('calendar');

            if ($this->overlapping($start, $end, null)) {
                return null;
            }

            return $this->create(['code' => $start->format('Y'), 'start_date' => $start->format('Y-m-d'), 'end_date' => $end->format('Y-m-d')]);
        });
    }

    /**
     * The year starting the day after $year ends; created like $year (same length, 13th period) when missing.
     */
    public function following(FiscalYear $year): FiscalYear
    {
        $start = CarbonImmutable::parse($year->end_date->format('Y-m-d'))->addDay();
        $existing = FiscalYear::query()->whereDate('start_date', $start->format('Y-m-d'))->first();

        if ($existing !== null) {
            return $existing;
        }

        $months = max(1, (int) round(CarbonImmutable::parse($year->start_date->format('Y-m-d'))->diffInMonths($start)));
        $end = $start->addMonths(min(12, $months))->subDay();
        $code = preg_match('/^\d{4}$/', $year->code) === 1 ? (string) ((int) $year->code + 1) : $start->format('Y');
        $adjustment = AccountingPeriod::query()->where('fiscal_year_id', $year->id)->where('number', AccountingPeriod::ADJUSTMENT)->exists();

        return $this->create(['code' => $code, 'start_date' => $start->format('Y-m-d'), 'end_date' => $end->format('Y-m-d'), 'adjustment_period' => $adjustment]);
    }

    /**
     * Monthly ranges from $start to $end.
     *
     * @return list<array{0: CarbonImmutable, 1: CarbonImmutable}>
     *
     * @throws ValidationException
     */
    public static function ranges(CarbonImmutable $start, CarbonImmutable $end): array
    {
        if ($end->lessThan($start)) {
            Messages::fail('end_date', 'fiscal_year_dates_invalid');
        }

        $ranges = [];
        $cursor = $start;

        while ($cursor->lessThanOrEqualTo($end)) {
            $monthEnd = $cursor->endOfMonth()->startOfDay();
            $rangeEnd = $monthEnd->lessThan($end) ? $monthEnd : $end;
            $ranges[] = [$cursor, $rangeEnd];
            $cursor = $rangeEnd->addDay();

            if (count($ranges) > 12) {
                Messages::fail('end_date', 'fiscal_year_too_long');
            }
        }

        return $ranges;
    }

    private function generatePeriods(FiscalYear $year, CarbonImmutable $start, CarbonImmutable $end, bool $adjustment): void
    {
        $ranges = self::ranges($start, $end);

        if ($adjustment) {
            $ranges[AccountingPeriod::ADJUSTMENT - 1] = [$end, $end];
        }

        foreach ($ranges as $index => [$from, $to]) {
            $period = new AccountingPeriod(['number' => $index + 1, 'start_date' => $from->format('Y-m-d'), 'end_date' => $to->format('Y-m-d')]);
            $period->fiscal_year_id = $year->id;
            $period->save();
        }

        // Surface a tiling violation here rather than at an outer commit.
        DB::statement('SET CONSTRAINTS accounting_periods_tiling, fiscal_years_tiling IMMEDIATE');
        DB::statement('SET CONSTRAINTS accounting_periods_tiling, fiscal_years_tiling DEFERRED');
    }

    private function assertNoOverlap(CarbonImmutable $start, CarbonImmutable $end, ?string $ignore): void
    {
        if ($this->overlapping($start, $end, $ignore)) {
            Messages::fail('start_date', 'fiscal_year_overlap');
        }
    }

    private function overlapping(CarbonImmutable $start, CarbonImmutable $end, ?string $ignore): bool
    {
        return FiscalYear::query()
            ->whereDate('start_date', '<=', $end->format('Y-m-d'))
            ->whereDate('end_date', '>=', $start->format('Y-m-d'))
            ->when($ignore !== null, fn ($q) => $q->whereKeyNot($ignore))
            ->exists();
    }

    /**
     * @template T
     *
     * @param  \Closure(): T  $fn
     * @return T
     */
    private function guarded(\Closure $fn): mixed
    {
        try {
            return Ledger::transaction($fn);
        } catch (QueryException $e) {
            $state = $e->errorInfo[0] ?? null;

            if ($state === '23P01') {
                Messages::fail('start_date', 'fiscal_year_overlap');
            }

            if ($state === '23505' && str_contains($e->getMessage(), 'fiscal_years_company_id_code_unique')) {
                Messages::fail('code', 'fiscal_year_code_taken');
            }

            throw $e;
        }
    }
}
