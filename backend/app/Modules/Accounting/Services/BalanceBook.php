<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Services;

use App\Modules\Accounting\Enums\EntryStatus;
use Brick\Math\BigDecimal;
use DateTimeInterface;
use Illuminate\Support\Facades\DB;

/**
 * account_balances: debit/credit totals per (account, period) over booked lines (entries posted or
 * reversed: a reversal is booked as its own entry, so both sides stay in the totals).
 */
final class BalanceBook
{
    /** Adds the lines of a booked entry; runs inside the posting transaction. */
    public function apply(string $companyId, string $entryId, string $periodId): void
    {
        DB::statement(<<<'SQL'
            INSERT INTO account_balances (company_id, account_id, period_id, debit_total, credit_total, updated_at)
            SELECT ?, account_id, ?, sum(debit), sum(credit), now()
            FROM journal_lines WHERE entry_id = ? GROUP BY account_id
            ON CONFLICT (account_id, period_id) DO UPDATE SET
                debit_total = account_balances.debit_total + excluded.debit_total,
                credit_total = account_balances.credit_total + excluded.credit_total,
                updated_at = now()
            SQL, [$companyId, $periodId, $entryId]);
    }

    /**
     * Recomputes every balance of a company from its booked lines.
     *
     * @return int rows written
     */
    public function rebuild(string $companyId): int
    {
        return DB::transaction(function () use ($companyId): int {
            DB::table('account_balances')->where('company_id', $companyId)->delete();

            return DB::affectingStatement(<<<'SQL'
                INSERT INTO account_balances (company_id, account_id, period_id, debit_total, credit_total, updated_at)
                SELECT e.company_id, l.account_id, e.period_id, sum(l.debit), sum(l.credit), now()
                FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
                WHERE e.company_id = ? AND e.status <> 'draft'
                GROUP BY e.company_id, l.account_id, e.period_id
                SQL, [$companyId]);
        });
    }

    /**
     * Booked totals of an account up to and including a date (all time when null), with the
     * foreign currency balance of lines in the account's currency.
     *
     * @return array{debit: BigDecimal, credit: BigDecimal, balance: BigDecimal, fx_balance: BigDecimal|null}
     */
    public function accountAsOf(string $accountId, ?DateTimeInterface $asOf, ?string $currency = null): array
    {
        $row = DB::table('journal_lines as l')
            ->join('journal_entries as e', 'e.id', '=', 'l.entry_id')
            ->where('l.account_id', $accountId)
            ->where('e.status', '<>', EntryStatus::Draft->value)
            ->when($asOf !== null, fn ($q) => $q->where('e.entry_date', '<=', $asOf?->format('Y-m-d')))
            ->selectRaw('coalesce(sum(l.debit), 0) as debit, coalesce(sum(l.credit), 0) as credit')
            ->selectRaw('coalesce(sum(case when l.currency_code = ? and l.debit > 0 then l.fx_amount when l.currency_code = ? then -l.fx_amount else 0 end), 0) as fx', [$currency, $currency])
            ->first();

        $debit = BigDecimal::of(is_object($row) && isset($row->debit) && is_string($row->debit) ? $row->debit : '0')->toScale(4);
        $credit = BigDecimal::of(is_object($row) && isset($row->credit) && is_string($row->credit) ? $row->credit : '0')->toScale(4);
        $fx = is_object($row) && isset($row->fx) && is_string($row->fx) ? BigDecimal::of($row->fx)->toScale(4) : BigDecimal::zero()->toScale(4);

        return ['debit' => $debit, 'credit' => $credit, 'balance' => $debit->minus($credit), 'fx_balance' => $currency === null ? null : $fx];
    }
}
