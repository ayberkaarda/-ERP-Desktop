<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Services;

use App\Modules\Accounting\Reports\Data\LedgerLine;
use App\Modules\Accounting\Reports\Data\Money;
use App\Modules\Accounting\Reports\Support\LedgerScope;
use Brick\Math\BigDecimal;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Pages of booked lines with a running balance that continues across pages: the balance before a
 * page is the opening balance plus the movement of all earlier lines of the range.
 */
final class LineLedger
{
    /** Filtered line query (LedgerScope::lines + range + filters) without select or order. */
    public function count(Builder $lines): int
    {
        return (clone $lines)->count('l.id');
    }

    /**
     * @return array{debit: BigDecimal, credit: BigDecimal}
     */
    public function totals(Builder $lines): array
    {
        $row = (clone $lines)->selectRaw('coalesce(sum(l.debit), 0) as debit, coalesce(sum(l.credit), 0) as credit')->first();

        return ['debit' => Money::col($row, 'debit'), 'credit' => Money::col($row, 'credit')];
    }

    /**
     * @return list<LedgerLine>
     */
    public function page(Builder $lines, BigDecimal $opening, int $offset, ?int $limit): array
    {
        $balance = $opening;

        if ($offset > 0) {
            $earlier = LedgerScope::lineOrder((clone $lines)->select(['l.debit', 'l.credit']))->limit($offset);
            $row = DB::query()->fromSub($earlier, 'x')->selectRaw('coalesce(sum(debit), 0) as debit, coalesce(sum(credit), 0) as credit')->first();
            $balance = $balance->plus(Money::col($row, 'debit'))->minus(Money::col($row, 'credit'));
        }

        $query = LedgerScope::lineOrder((clone $lines)
            ->join('accounts as a', 'a.id', '=', 'l.account_id')
            ->select([
                'l.id', 'l.entry_id', 'l.line_no', 'l.account_id', 'l.debit', 'l.credit', 'l.party_id', 'l.document_ref',
                'l.due_date', 'l.currency_code', 'l.fx_amount', 'a.code as account_code', 'a.name as account_name',
                'e.number', 'e.entry_date', 'e.entry_type', 'e.status',
            ])
            ->selectRaw('coalesce(l.description, e.description) as description'))
            ->offset($offset);

        if ($limit !== null) {
            $query->limit($limit);
        }

        $out = [];

        foreach ($query->cursor() as $row) {
            $debit = Money::col($row, 'debit');
            $credit = Money::col($row, 'credit');
            $balance = $balance->plus($debit)->minus($credit);
            $out[] = new LedgerLine(
                (string) $row->id,
                (string) $row->entry_id,
                self::text($row->number),
                (string) $row->entry_date,
                (string) $row->entry_type,
                (string) $row->status,
                (int) $row->line_no,
                (string) $row->account_id,
                (string) $row->account_code,
                (string) $row->account_name,
                self::text($row->description),
                Money::str($debit),
                Money::str($credit),
                Money::str($balance),
                self::text($row->party_id),
                self::text($row->document_ref),
                self::text($row->due_date),
                self::text($row->currency_code),
                $row->fx_amount === null ? null : Money::str(Money::of($row->fx_amount)),
            );
        }

        return $out;
    }

    private static function text(mixed $value): ?string
    {
        return is_string($value) ? $value : null;
    }
}
