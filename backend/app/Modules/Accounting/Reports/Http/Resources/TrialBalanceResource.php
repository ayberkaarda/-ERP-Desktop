<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Http\Resources;

use App\Modules\Accounting\Reports\Data\Amounts;
use App\Modules\Accounting\Reports\Data\Money;
use App\Modules\Accounting\Reports\Data\TrialBalance;
use App\Modules\Accounting\Reports\Data\TrialBalanceGroup;
use App\Modules\Accounting\Reports\Data\TrialBalanceRow;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Mizan. Every amount is a decimal string with four decimals. Per row and total: opening_debit,
 * opening_credit (before the range), debit, credit (movement), total_debit, total_credit
 * (cumulative) and the balance on its side (balance_debit or balance_credit).
 *
 * @property TrialBalance $resource
 */
final class TrialBalanceResource extends JsonResource
{
    /**
     * @return array{date_from: string, date_to: string, period_id: string|null, source: string, level: int|null, include_zero: bool, compare_with_previous_year: bool, previous_range: array{date_from: string, date_to: string, period_id: string|null, source: string|null}|null, rows: list<array<string, mixed>>, groups: list<array<string, mixed>>, totals: array<string, string>, previous_totals: array<string, string>|null, balanced: bool, difference: string}
     */
    public function toArray(Request $request): array
    {
        $report = $this->resource;

        return [
            ...$report->range->toArray(),
            'source' => $report->source->value,
            'level' => $report->level,
            'include_zero' => $report->includeZero,
            'compare_with_previous_year' => $report->previousRange !== null,
            'previous_range' => $report->previousRange === null ? null : [
                ...$report->previousRange->toArray(),
                'source' => $report->previousSource?->value,
            ],
            'rows' => array_map(self::row(...), $report->rows),
            'groups' => array_map(self::group(...), $report->groups),
            'totals' => $report->totals->toArray(),
            'previous_totals' => $report->previousTotals?->toArray(),
            'balanced' => $report->balanced(),
            'difference' => Money::str($report->totals->totalDebit()->minus($report->totals->totalCredit())),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function row(TrialBalanceRow $row): array
    {
        $account = $row->account;

        return [
            'account_id' => $account->id,
            'code' => $account->code,
            'name' => $account->name,
            'level' => $account->level,
            'parent_id' => $account->parent_id,
            'tdhp_group' => $account->tdhp_group,
            'type' => $account->type->value,
            'normal_balance' => $account->normal_balance->value,
            'is_postable' => $account->is_postable,
            'is_active' => $account->is_active,
            ...$row->amounts->toArray(),
            'previous' => self::previous($row->previous),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function group(TrialBalanceGroup $group): array
    {
        return [
            'tdhp_group' => $group->tdhpGroup,
            'name' => $group->name,
            ...$group->amounts->toArray(),
            'previous' => self::previous($group->previous),
        ];
    }

    /**
     * @return array<string, string>|null
     */
    private static function previous(?Amounts $amounts): ?array
    {
        return $amounts?->toArray();
    }
}
