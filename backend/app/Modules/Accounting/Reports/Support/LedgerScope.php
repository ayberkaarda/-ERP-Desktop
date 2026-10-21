<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Support;

use App\Modules\Accounting\Enums\EntryStatus;
use App\Modules\Accounting\Reports\Data\ReportRange;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Query building blocks over booked data of one company. Booked means posted or reversed: a
 * reversal is its own posted entry, so the original stays in the history; drafts never count.
 * Aliases: e = journal_entries, l = journal_lines, ap = accounting_periods, b = account_balances.
 */
final class LedgerScope
{
    /** Booked entries joined with their period. */
    public static function entries(string $companyId): Builder
    {
        return DB::table('journal_entries as e')
            ->join('accounting_periods as ap', 'ap.id', '=', 'e.period_id')
            ->where('e.company_id', $companyId)
            ->where('ap.company_id', $companyId)
            ->where('e.status', '<>', EntryStatus::Draft->value);
    }

    /** Lines of booked entries, joined with entry and period. */
    public static function lines(string $companyId): Builder
    {
        return self::entries($companyId)
            ->join('journal_lines as l', 'l.entry_id', '=', 'e.id')
            ->where('l.company_id', $companyId);
    }

    /** Entries inside the range. */
    public static function inRange(Builder $query, ReportRange $range): Builder
    {
        return $range->isPeriod()
            ? $query->where('e.period_id', $range->periodId)
            : $query->whereBetween('e.entry_date', [$range->from, $range->to]);
    }

    /** Entries before the range (the opening balance). */
    public static function beforeRange(Builder $query, ReportRange $range): Builder
    {
        return $range->isPeriod()
            ? $query->whereRaw('(ap.start_date, ap.number) < (?::date, ?)', [$range->from, $range->periodNumber])
            : $query->where('e.entry_date', '<', $range->from);
    }

    /** account_balances rows joined with their period. */
    public static function balances(string $companyId): Builder
    {
        return DB::table('account_balances as b')
            ->join('accounting_periods as ap', 'ap.id', '=', 'b.period_id')
            ->where('b.company_id', $companyId)
            ->where('ap.company_id', $companyId);
    }

    /** Balance rows of the periods inside an aligned range (or of the period itself). */
    public static function balancesInRange(Builder $query, ReportRange $range): Builder
    {
        return $range->isPeriod()
            ? $query->where('b.period_id', $range->periodId)
            : $query->whereDate('ap.start_date', '>=', $range->from)->whereDate('ap.end_date', '<=', $range->to);
    }

    /** Balance rows of the periods before the range. */
    public static function balancesBeforeRange(Builder $query, ReportRange $range): Builder
    {
        return $range->isPeriod()
            ? $query->whereRaw('(ap.start_date, ap.number) < (?::date, ?)', [$range->from, $range->periodNumber])
            : $query->whereDate('ap.end_date', '<', $range->from);
    }

    /** Order of the journal: fiscal year, then entry number (numeric order for equal prefixes). */
    public static function journalOrder(Builder $query): Builder
    {
        return $query->join('fiscal_years as fy', 'fy.id', '=', 'e.fiscal_year_id')
            ->orderBy('fy.start_date')->orderByRaw('length(e.number)')->orderBy('e.number');
    }

    /** Order of ledger lines: date, entry number, line number. */
    public static function lineOrder(Builder $query): Builder
    {
        return $query->orderBy('e.entry_date')->orderByRaw('length(e.number)')->orderBy('e.number')->orderBy('l.line_no')->orderBy('l.id');
    }
}
