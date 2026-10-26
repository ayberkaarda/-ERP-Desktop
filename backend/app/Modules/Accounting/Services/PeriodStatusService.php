<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Services;

use App\Modules\Accounting\Enums\EntryStatus;
use App\Modules\Accounting\Enums\FiscalYearStatus;
use App\Modules\Accounting\Enums\PeriodStatus;
use App\Modules\Accounting\Models\AccountingPeriod;
use App\Modules\Accounting\Models\FiscalYear;
use App\Modules\Accounting\Models\JournalEntry;
use App\Modules\Accounting\Support\Ledger;
use App\Modules\Accounting\Support\Messages;

/**
 * open -> soft_closed -> closed and back to open. The period row is locked FOR UPDATE, so a posting
 * that holds it FOR SHARE (journal entry trigger) finishes first, and a later one sees the new status.
 */
final class PeriodStatusService
{
    public function softClose(AccountingPeriod $period, ?string $actor, ?int $version = null): AccountingPeriod
    {
        return $this->move($period, PeriodStatus::SoftClosed, [PeriodStatus::Open], $actor, null, $version);
    }

    public function close(AccountingPeriod $period, ?string $actor, ?int $version = null): AccountingPeriod
    {
        return $this->move($period, PeriodStatus::Closed, [PeriodStatus::Open, PeriodStatus::SoftClosed], $actor, null, $version);
    }

    public function reopen(AccountingPeriod $period, ?string $actor, string $reason, ?int $version = null): AccountingPeriod
    {
        return $this->move($period, PeriodStatus::Open, [PeriodStatus::SoftClosed, PeriodStatus::Closed], $actor, $reason, $version);
    }

    /**
     * @param  list<PeriodStatus>  $from
     */
    private function move(AccountingPeriod $period, PeriodStatus $to, array $from, ?string $actor, ?string $reason, ?int $version): AccountingPeriod
    {
        return Ledger::transaction(function () use ($period, $to, $from, $actor, $reason, $version): AccountingPeriod {
            $locked = AccountingPeriod::query()->whereKey($period->id)->lockForUpdate()->firstOrFail();

            if ($version !== null) {
                $locked->assertVersion($version);
            }

            $before = $locked->status;

            if (! in_array($before, $from, true)) {
                Messages::fail('status', 'period_transition', ['from' => $before->value, 'to' => $to->value]);
            }

            $year = FiscalYear::query()->whereKey($locked->fiscal_year_id)->sharedLock()->firstOrFail();

            if ($year->status === FiscalYearStatus::Closed) {
                Messages::fail('status', 'fiscal_year_closed', ['year' => $year->code, 'period' => $locked->number]);
            }

            if ($to === PeriodStatus::Closed) {
                $drafts = JournalEntry::query()->where('period_id', $locked->id)->where('status', EntryStatus::Draft->value)->count();

                if ($drafts > 0) {
                    Messages::fail('status', 'period_has_drafts', ['count' => $drafts]);
                }
            }

            if ($to === PeriodStatus::Open && ($reason === null || trim($reason) === '')) {
                Messages::fail('reason', 'reason_required');
            }

            $locked->status = $to;
            $locked->closed_at = $to === PeriodStatus::Open ? null : now();
            $locked->closed_by = $to === PeriodStatus::Open ? null : $actor;
            $locked->save();

            activity()->performedOn($locked)->event('status_changed')
                ->withProperties(['from' => $before->value, 'to' => $to->value, 'reason' => $reason])
                ->log('status_changed');

            return $locked;
        });
    }
}
