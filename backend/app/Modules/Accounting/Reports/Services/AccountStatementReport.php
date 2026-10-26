<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Services;

use App\Modules\Accounting\Reports\Data\LedgerPage;
use App\Modules\Accounting\Reports\Data\ReportRange;
use App\Modules\Accounting\Reports\Data\Source;
use App\Modules\Accounting\Reports\Support\LedgerScope;
use Illuminate\Database\Query\Builder;

/**
 * Cari hesap ekstresi base: booked lines carrying a party, optionally limited to an account code
 * range (account_to includes its sub-accounts: 120 covers 120.01). account_balances has no party
 * dimension, so this report always reads the lines.
 */
final class AccountStatementReport
{
    public function __construct(private readonly LineLedger $ledger) {}

    /**
     * @param  int|null  $perPage  null: every line of the range (export)
     */
    public function build(string $companyId, string $partyId, ?string $accountFrom, ?string $accountTo, ReportRange $range, int $page, ?int $perPage): LedgerPage
    {
        $before = LedgerScope::beforeRange($this->filtered($companyId, $partyId, $accountFrom, $accountTo), $range);
        $opening = $this->ledger->totals($before);
        $lines = LedgerScope::inRange($this->filtered($companyId, $partyId, $accountFrom, $accountTo), $range);
        $totals = $this->ledger->totals($lines);
        $total = $this->ledger->count($lines);
        $size = $perPage ?? max(1, $total);
        $openingBalance = $opening['debit']->minus($opening['credit']);

        return new LedgerPage(
            $range,
            Source::Lines,
            $openingBalance,
            $totals['debit'],
            $totals['credit'],
            $this->ledger->page($lines, $openingBalance, ($page - 1) * $size, $perPage),
            $total,
            $page,
            $size,
        );
    }

    public function count(string $companyId, string $partyId, ?string $accountFrom, ?string $accountTo, ReportRange $range): int
    {
        return $this->ledger->count(LedgerScope::inRange($this->filtered($companyId, $partyId, $accountFrom, $accountTo), $range));
    }

    private function filtered(string $companyId, string $partyId, ?string $accountFrom, ?string $accountTo): Builder
    {
        $query = LedgerScope::lines($companyId)->where('l.party_id', $partyId);

        if ($accountFrom !== null || $accountTo !== null) {
            $query->whereIn('l.account_id', function (Builder $accounts) use ($companyId, $accountFrom, $accountTo): void {
                $accounts->from('accounts')->select('id')->where('company_id', $companyId);

                if ($accountFrom !== null) {
                    $accounts->whereRaw('code collate "C" >= ?', [$accountFrom]);
                }

                if ($accountTo !== null) {
                    $accounts->where(fn (Builder $q) => $q->whereRaw('code collate "C" <= ?', [$accountTo])
                        ->orWhere('code', 'like', addcslashes($accountTo, '%_\\').'%'));
                }
            });
        }

        return $query;
    }
}
