<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Services;

use App\Modules\Accounting\Reports\Data\Amounts;
use App\Modules\Accounting\Reports\Data\Money;
use App\Modules\Accounting\Reports\Data\ReportRange;
use App\Modules\Accounting\Reports\Data\Source;
use App\Modules\Accounting\Reports\Support\LedgerScope;
use Illuminate\Database\Query\Builder;
use LogicException;

/**
 * Opening and movement totals per account for a range, from account_balances when the range is
 * period aligned and from the booked lines otherwise. Both sources give the same numbers.
 */
final class AccountTotals
{
    public function sourceFor(ReportRange $range): Source
    {
        return $range->balancesUsable() ? Source::Balances : Source::Lines;
    }

    /**
     * @param  list<string>|null  $accountIds  restrict to these accounts
     * @return array<string, Amounts> by account id; accounts without any booking are absent
     */
    public function forRange(string $companyId, ReportRange $range, ?Source $source = null, ?array $accountIds = null): array
    {
        $source ??= $this->sourceFor($range);

        if ($source === Source::Balances && ! $range->balancesUsable()) {
            throw new LogicException('account_balances cannot answer a range that splits a period.');
        }

        [$opening, $movement] = $source === Source::Balances
            ? [
                LedgerScope::balancesBeforeRange(LedgerScope::balances($companyId), $range),
                LedgerScope::balancesInRange(LedgerScope::balances($companyId), $range),
            ]
            : [
                LedgerScope::beforeRange(LedgerScope::lines($companyId), $range),
                LedgerScope::inRange(LedgerScope::lines($companyId), $range),
            ];
        [$account, $sums] = $source === Source::Balances
            ? ['b.account_id', 'coalesce(sum(b.debit_total), 0) as debit, coalesce(sum(b.credit_total), 0) as credit']
            : ['l.account_id', 'coalesce(sum(l.debit), 0) as debit, coalesce(sum(l.credit), 0) as credit'];

        $before = $this->sums($opening, $account, $sums, $accountIds);
        $inside = $this->sums($movement, $account, $sums, $accountIds);
        $result = [];

        foreach (array_unique([...array_keys($before), ...array_keys($inside)]) as $id) {
            $o = $before[$id] ?? ['0', '0'];
            $m = $inside[$id] ?? ['0', '0'];
            $result[(string) $id] = Amounts::of($o[0], $o[1], $m[0], $m[1]);
        }

        return $result;
    }

    /**
     * @param  list<string>|null  $accountIds
     */
    public function sum(string $companyId, ReportRange $range, ?Source $source = null, ?array $accountIds = null): Amounts
    {
        $total = Amounts::zero();

        foreach ($this->forRange($companyId, $range, $source, $accountIds) as $amounts) {
            $total = $total->plus($amounts);
        }

        return $total;
    }

    /**
     * @param  literal-string  $sums
     * @param  list<string>|null  $accountIds
     * @return array<string, array{0: string, 1: string}>
     */
    private function sums(Builder $query, string $account, string $sums, ?array $accountIds): array
    {
        if ($accountIds !== null) {
            $query->whereIn($account, $accountIds === [] ? ['00000000-0000-0000-0000-000000000000'] : $accountIds);
        }

        $rows = $query->groupBy($account)
            ->select($account.' as account_id')
            ->selectRaw($sums)
            ->get();
        $out = [];

        foreach ($rows as $row) {
            $out[(string) $row->account_id] = [Money::str(Money::col($row, 'debit')), Money::str(Money::col($row, 'credit'))];
        }

        return $out;
    }
}
