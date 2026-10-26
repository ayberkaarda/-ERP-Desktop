<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Services;

use App\Modules\Accounting\Reports\Data\JournalBook;
use App\Modules\Accounting\Reports\Data\JournalBookEntry;
use App\Modules\Accounting\Reports\Data\JournalBookLine;
use App\Modules\Accounting\Reports\Data\Money;
use App\Modules\Accounting\Reports\Data\ReportRange;
use App\Modules\Accounting\Reports\Data\Source;
use App\Modules\Accounting\Reports\Support\LedgerScope;
use Brick\Math\BigDecimal;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Yevmiye defteri: booked entries of the range in journal order (fiscal year, number), paginated by
 * entry, with devreden/nakledilen totals. The amount before the range and the range totals come
 * from account_balances when the range is period aligned.
 */
final class JournalBookReport
{
    public function __construct(private readonly AccountTotals $totals) {}

    /**
     * @param  int|null  $perPage  null: every entry of the range (export)
     */
    public function build(string $companyId, ReportRange $range, int $page, ?int $perPage, ?Source $source = null): JournalBook
    {
        $source ??= $this->totals->sourceFor($range);
        $entries = LedgerScope::inRange(LedgerScope::entries($companyId), $range);
        $total = (clone $entries)->count('e.id');
        $size = $perPage ?? max(1, $total);
        $offset = ($page - 1) * $size;
        $carried = $this->carriedForward($companyId, $range, $source);

        $brought = $carried;

        if ($offset > 0) {
            $earlier = LedgerScope::journalOrder((clone $entries)->select(['e.total_debit', 'e.total_credit']))->limit($offset);
            $brought = $this->plus($carried, $this->pair(DB::query()->fromSub($earlier, 'x')
                ->selectRaw('coalesce(sum(total_debit), 0) as debit, coalesce(sum(total_credit), 0) as credit')->first()));
        }

        $rows = LedgerScope::journalOrder((clone $entries)->select([
            'e.id', 'e.number', 'e.entry_date', 'e.entry_type', 'e.status', 'e.description', 'e.total_debit', 'e.total_credit',
        ]))->offset($offset)->limit($size)->get();
        $lines = $this->lines($companyId, array_values($rows->map(fn (object $row): string => (string) $row->id)->all()));

        $book = [];
        $pageTotals = ['debit' => BigDecimal::zero(), 'credit' => BigDecimal::zero()];

        foreach ($rows as $row) {
            $debit = Money::col($row, 'total_debit');
            $credit = Money::col($row, 'total_credit');
            $pageTotals = $this->plus($pageTotals, ['debit' => $debit, 'credit' => $credit]);
            $book[] = new JournalBookEntry(
                (string) $row->id,
                (string) $row->number,
                (string) $row->entry_date,
                (string) $row->entry_type,
                (string) $row->status,
                is_string($row->description) ? $row->description : null,
                Money::str($debit),
                Money::str($credit),
                $lines[(string) $row->id] ?? [],
            );
        }

        return new JournalBook(
            $range,
            $source,
            $book,
            $carried,
            $brought,
            $pageTotals,
            $this->rangeTotals($companyId, $range, $source, $entries),
            $total,
            $page,
            $size,
        );
    }

    /** Number of lines of the range (export cap check). */
    public function lineCount(string $companyId, ReportRange $range): int
    {
        return LedgerScope::inRange(LedgerScope::lines($companyId), $range)->count('l.id');
    }

    /**
     * Booked totals of the same fiscal year before the range.
     *
     * @return array{debit: BigDecimal, credit: BigDecimal}
     */
    private function carriedForward(string $companyId, ReportRange $range, Source $source): array
    {
        if ($range->fiscalYearId === null) {
            return ['debit' => BigDecimal::zero(), 'credit' => BigDecimal::zero()];
        }

        $query = $source === Source::Balances
            ? LedgerScope::balancesBeforeRange(LedgerScope::balances($companyId), $range)
                ->selectRaw('coalesce(sum(b.debit_total), 0) as debit, coalesce(sum(b.credit_total), 0) as credit')
            : LedgerScope::beforeRange(LedgerScope::entries($companyId), $range)
                ->selectRaw('coalesce(sum(e.total_debit), 0) as debit, coalesce(sum(e.total_credit), 0) as credit');

        return $this->pair($query->where('ap.fiscal_year_id', $range->fiscalYearId)->first());
    }

    /**
     * @return array{debit: BigDecimal, credit: BigDecimal}
     */
    private function rangeTotals(string $companyId, ReportRange $range, Source $source, Builder $entries): array
    {
        if ($source === Source::Balances) {
            $sum = $this->totals->sum($companyId, $range, Source::Balances);

            return ['debit' => $sum->debit, 'credit' => $sum->credit];
        }

        return $this->pair((clone $entries)->selectRaw('coalesce(sum(e.total_debit), 0) as debit, coalesce(sum(e.total_credit), 0) as credit')->first());
    }

    /**
     * @param  list<string>  $entryIds
     * @return array<string, list<JournalBookLine>>
     */
    private function lines(string $companyId, array $entryIds): array
    {
        $out = [];

        // Chunks keep the bound parameters far below the driver limit on a full-range export.
        foreach (array_chunk($entryIds, 5000) as $chunk) {
            foreach ($this->lineRows($companyId, $chunk) as $row) {
                $out[(string) $row->entry_id][] = new JournalBookLine(
                    (int) $row->line_no,
                    (string) $row->account_id,
                    (string) $row->code,
                    (string) $row->name,
                    is_string($row->description) ? $row->description : null,
                    Money::str(Money::col($row, 'debit')),
                    Money::str(Money::col($row, 'credit')),
                    is_string($row->party_id) ? $row->party_id : null,
                );
            }
        }

        return $out;
    }

    /**
     * @param  list<string>  $entryIds
     * @return Collection<int, stdClass>
     */
    private function lineRows(string $companyId, array $entryIds): Collection
    {
        return DB::table('journal_lines as l')
            ->join('accounts as a', 'a.id', '=', 'l.account_id')
            ->where('l.company_id', $companyId)
            ->whereIn('l.entry_id', $entryIds)
            ->orderBy('l.entry_id')->orderBy('l.line_no')
            ->get(['l.entry_id', 'l.line_no', 'l.account_id', 'a.code', 'a.name', 'l.description', 'l.debit', 'l.credit', 'l.party_id']);
    }

    /**
     * @return array{debit: BigDecimal, credit: BigDecimal}
     */
    private function pair(?object $row): array
    {
        return ['debit' => Money::col($row, 'debit'), 'credit' => Money::col($row, 'credit')];
    }

    /**
     * @param  array{debit: BigDecimal, credit: BigDecimal}  $a
     * @param  array{debit: BigDecimal, credit: BigDecimal}  $b
     * @return array{debit: BigDecimal, credit: BigDecimal}
     */
    private function plus(array $a, array $b): array
    {
        return ['debit' => $a['debit']->plus($b['debit']), 'credit' => $a['credit']->plus($b['credit'])];
    }
}
