<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Services;

use App\Modules\Accounting\Enums\AccountType;
use App\Modules\Accounting\Enums\EntryStatus;
use App\Modules\Accounting\Enums\EntryType;
use App\Modules\Accounting\Enums\FiscalYearStatus;
use App\Modules\Accounting\Enums\PeriodStatus;
use App\Modules\Accounting\Events\FiscalYearStatusChanged;
use App\Modules\Accounting\Models\Account;
use App\Modules\Accounting\Models\AccountingPeriod;
use App\Modules\Accounting\Models\FiscalYear;
use App\Modules\Accounting\Models\JournalEntry;
use App\Modules\Accounting\Support\AccountingSettings;
use App\Modules\Accounting\Support\Ledger;
use App\Modules\Accounting\Support\LineInput;
use App\Modules\Accounting\Support\Messages;
use Brick\Math\BigDecimal;
use Closure;
use DateTimeImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Year-end closing (TDHP default, configurable through accounting.closing_mapping):
 *  1. income statement accounts (groups 6 and 7) -> result account 690,
 *  2. 690 and tax provisions 691 -> net result account 692,
 *  3. 692 -> 590 (profit, credit balance) or 591 (loss, debit balance),
 *  4. balance sheet accounts closed (kapanış kaydı), dated the last day, in period 13 if it exists,
 *  5. opening entry (açılış kaydı) of the next year with the same balances, on its first day.
 * Then every period and the year are closed. The generated entries can only be undone by reopening
 * the year, which reverses them and reopens the last period.
 */
final class YearEndClosing
{
    public const string SOURCE = 'fiscal_year';

    public function __construct(
        private readonly LedgerPoster $poster,
        private readonly FiscalCalendar $calendar,
        private readonly AccountingSettings $settings,
        private readonly Periods $periods,
    ) {}

    public function close(FiscalYear $year, ?string $actor, ?int $version = null): FiscalYear
    {
        return Ledger::transaction(function () use ($year, $actor, $version): FiscalYear {
            Ledger::lock('calendar');
            $locked = FiscalYear::query()->whereKey($year->id)->lockForUpdate()->firstOrFail();

            if ($version !== null) {
                $locked->assertVersion($version);
            }

            if (! $locked->isOpen()) {
                Messages::fail('status', 'fiscal_year_already_closed');
            }

            $previous = FiscalYear::query()->whereDate('end_date', '<', $locked->start_date->format('Y-m-d'))->orderByDesc('end_date')->first();

            if ($previous !== null && $previous->isOpen()) {
                Messages::fail('status', 'previous_year_open', ['year' => $previous->code]);
            }

            if (JournalEntry::query()->where('fiscal_year_id', $locked->id)->where('status', EntryStatus::Draft->value)->exists()) {
                Messages::fail('status', 'year_has_drafts');
            }

            $last = $this->lastPeriod($locked);

            if ($last->status === PeriodStatus::Closed) {
                Messages::fail('status', 'closing_period_closed', ['period' => $last->number]);
            }

            $next = $this->calendar->following($locked);
            $opening = AccountingPeriod::query()->with('fiscalYear')->where('fiscal_year_id', $next->id)->orderBy('number')->firstOrFail();
            $this->periods->assertPostable($opening, allowSoftClosed: true);

            $this->generate($locked, $next->code, function (EntryType $type, array $lines, array $attributes) use ($actor, $last, $opening): void {
                $periodId = $type === EntryType::Opening ? $opening->id : $last->id;
                $this->poster->book($lines, $attributes, $actor, true, $periodId, strict: false);
            });

            foreach (AccountingPeriod::query()->where('fiscal_year_id', $locked->id)->where('status', '<>', PeriodStatus::Closed->value)->get() as $period) {
                $period->status = PeriodStatus::Closed;
                $period->closed_at = now();
                $period->closed_by = $actor;
                $period->save();
            }

            $locked->status = FiscalYearStatus::Closed;
            $locked->closed_at = now();
            $locked->closed_by = $actor;
            $locked->save();

            activity()->performedOn($locked)->event('closed')->withProperties(['next_year_id' => $next->id])->log('closed');
            event(new FiscalYearStatusChanged($locked->company_id, $locked->id, FiscalYearStatus::Closed->value));

            return $locked->load('periods');
        });
    }

    /**
     * What close() would generate, computed without writing anything. Conditions that would block
     * the closing are reported as warnings instead of failing.
     *
     * @return array{result: string, result_side: string|null, result_account_code: string|null, entries: list<array{entry_type: string, description: string, entry_date: string, line_count: int, total_debit: string, total_credit: string}>, warnings: list<string>}
     */
    public function preview(FiscalYear $year): array
    {
        $warnings = [];

        if (! $year->isOpen()) {
            $warnings[] = Messages::get('fiscal_year_already_closed');
        }

        $previous = FiscalYear::query()->whereDate('end_date', '<', $year->start_date->format('Y-m-d'))->orderByDesc('end_date')->first();

        if ($previous !== null && $previous->isOpen()) {
            $warnings[] = Messages::get('previous_year_open', ['year' => $previous->code]);
        }

        if (JournalEntry::query()->where('fiscal_year_id', $year->id)->where('status', EntryStatus::Draft->value)->exists()) {
            $warnings[] = Messages::get('year_has_drafts');
        }

        $last = AccountingPeriod::query()->where('fiscal_year_id', $year->id)->orderByDesc('number')->first();

        if ($last !== null && $last->status === PeriodStatus::Closed && $year->isOpen()) {
            $warnings[] = Messages::get('closing_period_closed', ['period' => $last->number]);
        }

        $nextStart = (new DateTimeImmutable($year->end_date->format('Y-m-d')))->modify('+1 day');
        $next = FiscalYear::query()->whereDate('start_date', $nextStart->format('Y-m-d'))->first();
        $nextCode = $next !== null ? $next->code : (preg_match('/^\d{4}$/', $year->code) === 1 ? (string) ((int) $year->code + 1) : $nextStart->format('Y'));

        $entries = [];
        $result = ['result' => '0.0000', 'result_side' => null, 'result_account_code' => null];

        try {
            $result = $this->generate($year, $nextCode, function (EntryType $type, array $lines, array $attributes) use (&$entries): void {
                $debit = BigDecimal::zero()->toScale(4);
                $credit = BigDecimal::zero()->toScale(4);

                foreach ($lines as $line) {
                    $debit = $debit->plus($line->debit);
                    $credit = $credit->plus($line->credit);
                }

                $entries[] = [
                    'entry_type' => $type->value,
                    'description' => is_string($attributes['description']) ? $attributes['description'] : '',
                    'entry_date' => is_string($attributes['entry_date']) ? $attributes['entry_date'] : '',
                    'line_count' => count($lines),
                    'total_debit' => (string) $debit,
                    'total_credit' => (string) $credit,
                ];
            });
        } catch (ValidationException $e) {
            foreach ($e->errors() as $messages) {
                foreach ($messages as $message) {
                    $warnings[] = (string) $message;
                }
            }
        }

        return [...$result, 'entries' => $entries, 'warnings' => $warnings];
    }

    public function reopen(FiscalYear $year, string $reason, ?string $actor, ?int $version = null): FiscalYear
    {
        return Ledger::transaction(function () use ($year, $reason, $actor, $version): FiscalYear {
            Ledger::lock('calendar');
            $locked = FiscalYear::query()->whereKey($year->id)->lockForUpdate()->firstOrFail();

            if ($version !== null) {
                $locked->assertVersion($version);
            }

            if ($locked->isOpen()) {
                Messages::fail('status', 'fiscal_year_not_closed');
            }

            if (trim($reason) === '') {
                Messages::fail('reason', 'reason_required');
            }

            $next = FiscalYear::query()->whereDate('start_date', '>', $locked->end_date->format('Y-m-d'))->orderBy('start_date')->first();

            if ($next !== null && ! $next->isOpen()) {
                Messages::fail('status', 'next_year_closed', ['year' => $next->code]);
            }

            $locked->status = FiscalYearStatus::Open;
            $locked->closed_at = null;
            $locked->closed_by = null;
            $locked->save();

            $last = $this->lastPeriod($locked);
            $last->status = PeriodStatus::Open;
            $last->closed_at = null;
            $last->closed_by = null;
            $last->save();

            $generated = JournalEntry::query()
                ->where('source_type', self::SOURCE)->where('source_id', $locked->id)
                // Only the entries of the latest closing run: earlier runs are already reversed, and
                // their reversal entries (same source) must never be reversed again.
                ->whereIn('entry_type', [EntryType::Closing->value, EntryType::Opening->value])
                ->where('status', EntryStatus::Posted->value)
                ->lockForUpdate()
                ->orderByDesc('posted_at')->orderByDesc('number')->get();

            foreach ($generated as $entry) {
                $this->poster->reverseEntry($entry->id, $entry->entry_date, $reason, $actor, allowGenerated: true, allowSoftClosed: true, periodId: $entry->period_id);
            }

            activity()->performedOn($locked)->event('reopened')->withProperties(['reason' => $reason])->log('reopened');
            event(new FiscalYearStatusChanged($locked->company_id, $locked->id, FiscalYearStatus::Open->value));

            return $locked->load('periods');
        });
    }

    private function lastPeriod(FiscalYear $year): AccountingPeriod
    {
        return AccountingPeriod::query()->with('fiscalYear')->where('fiscal_year_id', $year->id)->orderByDesc('number')->lockForUpdate()->firstOrFail();
    }

    /**
     * Computes the closing and opening entries and hands each one to $book.
     *
     * @param  Closure(EntryType, list<LineInput>, array<string, mixed>): void  $book
     * @return array{result: string, result_side: string|null, result_account_code: string|null}
     */
    private function generate(FiscalYear $year, string $nextCode, Closure $book): array
    {
        $mapping = $this->settings->closingMapping();
        $special = [$mapping['result_account'], ...$mapping['tax_accounts'], $mapping['net_result_account']];
        $needed = array_unique([$mapping['result_account'], $mapping['net_result_account'], $mapping['profit_account'], $mapping['loss_account'], ...$mapping['tax_accounts']]);
        $byCode = Account::query()->whereIn('code', $needed)->get()->keyBy('code');

        foreach ([$mapping['result_account'], $mapping['net_result_account'], $mapping['profit_account'], $mapping['loss_account']] as $code) {
            $account = $byCode->get($code);

            if ($account === null || ! $account->is_postable) {
                Messages::fail('status', 'closing_account_missing', ['code' => $code]);
            }
        }

        [$balances, $fx, $accounts] = $this->yearBalances($year);
        $run = (string) Str::uuid7();
        $date = new DateTimeImmutable($year->end_date->format('Y-m-d'));
        $isIncome = static fn (Account $a): bool => $a->tdhp_group !== null
            ? in_array($a->tdhp_group, $mapping['income_statement_groups'], true)
            : in_array($a->type, [AccountType::Revenue, AccountType::Expense, AccountType::Cost], true);

        // 1. Income statement accounts into the result account.
        $sources = $accounts->filter(fn (Account $a): bool => $isIncome($a) && ! in_array($a->code, $special, true));
        $this->transfer($sources, $this->account($byCode, $mapping['result_account']), $balances, $year, $date, $book, "{$run}:income", 'closing_income');

        // 2. Result and tax provisions into the net result account.
        $resultCodes = [$mapping['result_account'], ...$mapping['tax_accounts']];
        $sources = $byCode->filter(fn (Account $a): bool => in_array($a->code, $resultCodes, true))->values();
        $this->transfer($sources, $this->account($byCode, $mapping['net_result_account']), $balances, $year, $date, $book, "{$run}:result", 'closing_result');

        // 3. Net result into profit (credit balance) or loss (debit balance).
        $net = $this->account($byCode, $mapping['net_result_account']);
        $netBalance = $balances[$net->id] ?? BigDecimal::zero();
        $result = ['result' => (string) $netBalance->abs()->toScale(4), 'result_side' => null, 'result_account_code' => null];

        if (! $netBalance->isZero()) {
            $target = $this->account($byCode, $netBalance->isNegative() ? $mapping['profit_account'] : $mapping['loss_account']);
            $result['result_side'] = $netBalance->isNegative() ? 'credit' : 'debit';
            $result['result_account_code'] = $target->code;
            $this->transfer(collect([$net]), $target, $balances, $year, $date, $book, "{$run}:net", 'closing_net');
        }

        // 4. Balance sheet accounts closed; 5. reopened in the next year.
        $lines = [];
        // Targets of the transfers (590/591) may have had no lines of their own this year.
        $accounts = Account::query()->whereIn('id', array_keys($balances))->get();

        foreach ($accounts->filter(fn (Account $a): bool => ! $isIncome($a) && ! in_array($a->code, $special, true))->sortBy('code') as $account) {
            $balance = $balances[$account->id] ?? BigDecimal::zero();

            if ($balance->isZero()) {
                continue;
            }

            $f = $fx[$account->id] ?? BigDecimal::zero();
            $carryFx = $account->currency_code !== null && ! $f->isZero() && $f->isNegative() === $balance->isNegative();
            $lines[] = new LineInput(
                $account,
                $balance->isNegative() ? $balance->negated() : BigDecimal::zero()->toScale(4),
                $balance->isNegative() ? BigDecimal::zero()->toScale(4) : $balance,
                $carryFx ? $account->currency_code : null,
                $carryFx ? $f->abs() : null,
            );
        }

        if ($lines === []) {
            return $result;
        }

        $book(EntryType::Closing, $lines, $this->attributes(EntryType::Closing, $date, $year, "{$run}:balance", 'closing_balance_sheet'));

        $openingDate = $date->modify('+1 day');
        $mirrored = array_map(static fn (LineInput $l): LineInput => $l->mirrored(), $lines);
        $book(EntryType::Opening, $mirrored, $this->attributes(EntryType::Opening, $openingDate, $year, "{$run}:opening", 'opening_entry', $nextCode));

        return $result;
    }

    /**
     * Zeroes the source accounts against one target account and updates the running balances.
     *
     * @param  Collection<int, Account>  $sources
     * @param  array<string, BigDecimal>  $balances  debit-positive balances, updated in place
     * @param  Closure(EntryType, list<LineInput>, array<string, mixed>): void  $book
     */
    private function transfer(Collection $sources, Account $target, array &$balances, FiscalYear $year, DateTimeImmutable $date, Closure $book, string $purpose, string $descriptionKey): void
    {
        $lines = [];
        $sum = BigDecimal::zero();

        foreach ($sources->sortBy('code') as $account) {
            $balance = $balances[$account->id] ?? BigDecimal::zero();

            if ($balance->isZero() || $account->id === $target->id) {
                continue;
            }

            $sum = $sum->plus($balance);
            $balances[$account->id] = BigDecimal::zero();
            $lines[] = $balance->isPositive()
                ? new LineInput($account, BigDecimal::zero()->toScale(4), $balance)
                : new LineInput($account, $balance->negated(), BigDecimal::zero()->toScale(4));
        }

        if ($lines === []) {
            return;
        }

        if (! $sum->isZero()) {
            $lines[] = $sum->isPositive()
                ? new LineInput($target, $sum, BigDecimal::zero()->toScale(4))
                : new LineInput($target, BigDecimal::zero()->toScale(4), $sum->negated());
        }

        $balances[$target->id] = ($balances[$target->id] ?? BigDecimal::zero())->plus($sum);
        $book(EntryType::Closing, $lines, $this->attributes(EntryType::Closing, $date, $year, $purpose, $descriptionKey));
    }

    /**
     * @return array<string, mixed>
     */
    private function attributes(EntryType $type, DateTimeImmutable $date, FiscalYear $year, string $purpose, string $descriptionKey, ?string $nextCode = null): array
    {
        return [
            'entry_type' => $type,
            'entry_date' => $date->format('Y-m-d'),
            'description' => Messages::get($descriptionKey, ['year' => $nextCode ?? $year->code]),
            'source_type' => self::SOURCE,
            'source_id' => $year->id,
            'posting_key' => self::SOURCE.'|'.$year->id.'|'.$purpose,
        ];
    }

    /**
     * Debit-positive balances and foreign-currency balances of the year's booked lines.
     *
     * @return array{0: array<string, BigDecimal>, 1: array<string, BigDecimal>, 2: Collection<int, Account>}
     */
    private function yearBalances(FiscalYear $year): array
    {
        $rows = DB::table('journal_lines as l')
            ->join('journal_entries as e', 'e.id', '=', 'l.entry_id')
            ->join('accounts as a', 'a.id', '=', 'l.account_id')
            ->where('e.fiscal_year_id', $year->id)
            ->where('e.status', '<>', EntryStatus::Draft->value)
            ->groupBy('l.account_id')
            ->selectRaw('l.account_id, sum(l.debit) - sum(l.credit) as balance')
            ->selectRaw('coalesce(sum(case when l.currency_code = a.currency_code and l.debit > 0 then l.fx_amount when l.currency_code = a.currency_code then -l.fx_amount else 0 end), 0) as fx')
            ->get();

        $balances = [];
        $fx = [];

        foreach ($rows as $row) {
            $id = isset($row->account_id) && is_string($row->account_id) ? $row->account_id : null;

            if ($id === null) {
                continue;
            }

            $balances[$id] = BigDecimal::of(isset($row->balance) && is_string($row->balance) ? $row->balance : '0')->toScale(4);
            $fx[$id] = BigDecimal::of(isset($row->fx) && is_string($row->fx) ? $row->fx : '0')->toScale(4);
        }

        $accounts = Account::query()->whereIn('id', array_keys($balances))->get();

        return [$balances, $fx, $accounts->values()];
    }

    /**
     * @param  Collection<string, Account>  $byCode
     */
    private function account(Collection $byCode, string $code): Account
    {
        return $byCode->get($code) ?? Messages::fail('status', 'closing_account_missing', ['code' => $code]);
    }
}
