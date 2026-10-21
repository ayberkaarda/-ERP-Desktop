<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Services;

use App\Modules\Accounting\Reports\Data\Amounts;
use App\Modules\Accounting\Reports\Data\ReportRange;
use App\Modules\Accounting\Reports\Data\Source;
use App\Modules\Accounting\Reports\Data\TrialBalance;
use App\Modules\Accounting\Reports\Data\TrialBalanceGroup;
use App\Modules\Accounting\Reports\Data\TrialBalanceRow;
use App\Modules\Accounting\Reports\Support\AccountTree;

final class TrialBalanceReport
{
    public function __construct(
        private readonly AccountTotals $totals,
        private readonly RangeResolver $ranges,
    ) {}

    /**
     * @param  int|null  $level  deepest account level shown (null: all levels)
     * @param  Source|null  $source  forces a source (tests); null picks balances when aligned
     */
    public function build(string $companyId, ReportRange $range, ?int $level, bool $includeZero, bool $compare, ?Source $source = null): TrialBalance
    {
        $tree = new AccountTree;
        $source ??= $this->totals->sourceFor($range);
        $own = $this->totals->forRange($companyId, $range, $source);

        $previousRange = null;
        $previousSource = null;
        $previousOwn = [];

        if ($compare) {
            $previousRange = $this->ranges->previousYear($range);
            $previousSource = $source === Source::Lines ? Source::Lines : $this->totals->sourceFor($previousRange);
            $previousOwn = $this->totals->forRange($companyId, $previousRange, $previousSource);
        }

        $rolled = $this->rollUp($tree, $own);
        $previousRolled = $this->rollUp($tree, $previousOwn);

        $rows = [];

        foreach ($tree->all() as $id => $account) {
            if ($level !== null && $account->level > $level) {
                continue;
            }

            $amounts = $rolled[$id] ?? Amounts::zero();
            $previous = $compare ? ($previousRolled[$id] ?? Amounts::zero()) : null;

            if (! $includeZero && $amounts->isZero() && ($previous === null || $previous->isZero())) {
                continue;
            }

            $rows[] = new TrialBalanceRow($account, $amounts, $previous);
        }

        return new TrialBalance(
            $range,
            $source,
            $level,
            $includeZero,
            $rows,
            $this->groups($tree, $own, $previousOwn, $compare),
            $this->sum($own),
            $previousRange,
            $previousSource,
            $compare ? $this->sum($previousOwn) : null,
        );
    }

    /**
     * Adds every account's own bookings to itself and all its ancestors.
     *
     * @param  array<string, Amounts>  $own
     * @return array<string, Amounts>
     */
    private function rollUp(AccountTree $tree, array $own): array
    {
        $rolled = [];

        foreach ($own as $id => $amounts) {
            foreach ($tree->selfAndAncestors($id) as $target) {
                $rolled[$target] = isset($rolled[$target]) ? $rolled[$target]->plus($amounts) : $amounts;
            }
        }

        return $rolled;
    }

    /**
     * @param  array<string, Amounts>  $own
     * @param  array<string, Amounts>  $previousOwn
     * @return list<TrialBalanceGroup>
     */
    private function groups(AccountTree $tree, array $own, array $previousOwn, bool $compare): array
    {
        $names = [];

        foreach ($tree->all() as $account) {
            $key = $account->tdhp_group ?? 0;

            if ($account->level === 1 && $account->tdhp_group !== null && ! isset($names[$key])) {
                $names[$key] = $account->name;
            }
        }

        $current = $this->byGroup($tree, $own);
        $previous = $this->byGroup($tree, $previousOwn);
        $keys = array_unique([...array_keys($current), ...array_keys($previous)]);
        sort($keys);
        $groups = [];

        foreach ($keys as $key) {
            $groups[] = new TrialBalanceGroup(
                $key === 0 ? null : $key,
                $names[$key] ?? null,
                $current[$key] ?? Amounts::zero(),
                $compare ? ($previous[$key] ?? Amounts::zero()) : null,
            );
        }

        return $groups;
    }

    /**
     * @param  array<string, Amounts>  $own
     * @return array<int, Amounts> by TDHP class (0: none)
     */
    private function byGroup(AccountTree $tree, array $own): array
    {
        $members = [];

        foreach ($own as $id => $amounts) {
            $members[$tree->get($id)->tdhp_group ?? 0][] = $amounts;
        }

        return array_map(Amounts::accounts(...), $members);
    }

    /**
     * @param  array<string, Amounts>  $own
     */
    private function sum(array $own): Amounts
    {
        return Amounts::accounts($own);
    }
}
