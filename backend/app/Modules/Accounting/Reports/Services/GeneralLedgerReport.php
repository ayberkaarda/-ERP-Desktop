<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Services;

use App\Modules\Accounting\Models\Account;
use App\Modules\Accounting\Reports\Data\LedgerPage;
use App\Modules\Accounting\Reports\Data\ReportRange;
use App\Modules\Accounting\Reports\Data\Source;
use App\Modules\Accounting\Reports\Support\AccountTree;
use App\Modules\Accounting\Reports\Support\LedgerScope;
use Illuminate\Database\Query\Builder;

/**
 * Büyük defter of one account; a parent account shows the lines of all its sub-accounts.
 * Opening balance and range totals come from account_balances when the range is period aligned.
 */
final class GeneralLedgerReport
{
    public function __construct(
        private readonly AccountTotals $totals,
        private readonly LineLedger $ledger,
    ) {}

    /**
     * @param  int|null  $perPage  null: every line of the range (export)
     */
    public function build(string $companyId, Account $account, ReportRange $range, int $page, ?int $perPage, ?Source $source = null): LedgerPage
    {
        $ids = (new AccountTree)->selfAndDescendants($account->id);
        $source ??= $this->totals->sourceFor($range);
        $sum = $this->totals->sum($companyId, $range, $source, $ids);
        $lines = $this->lines($companyId, $range, $ids);
        $total = $this->ledger->count($lines);
        $size = $perPage ?? max(1, $total);

        return new LedgerPage(
            $range,
            $source,
            $sum->openingBalance(),
            $sum->debit,
            $sum->credit,
            $this->ledger->page($lines, $sum->openingBalance(), ($page - 1) * $size, $perPage),
            $total,
            $page,
            $size,
        );
    }

    /** Number of lines of the range (export cap check). */
    public function count(string $companyId, ReportRange $range, Account $account): int
    {
        return $this->ledger->count($this->lines($companyId, $range, (new AccountTree)->selfAndDescendants($account->id)));
    }

    /**
     * @param  list<string>  $accountIds
     */
    private function lines(string $companyId, ReportRange $range, array $accountIds): Builder
    {
        return LedgerScope::inRange(LedgerScope::lines($companyId), $range)->whereIn('l.account_id', $accountIds);
    }
}
