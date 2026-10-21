<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Services;

use App\Core\Money\RoundingPolicy;
use App\Modules\Accounting\Contracts\AccountDeterminer;
use App\Modules\Accounting\Enums\EntryStatus;
use App\Modules\Accounting\Enums\EntryType;
use App\Modules\Accounting\Models\Account;
use App\Modules\Accounting\Models\AccountingPeriod;
use App\Modules\Accounting\Models\JournalEntry;
use App\Modules\Accounting\Support\AccountingSettings;
use App\Modules\Accounting\Support\Ledger;
use App\Modules\Accounting\Support\LineInput;
use App\Modules\Accounting\Support\Messages;
use App\Modules\Reference\Contracts\ExchangeRateProvider;
use App\Modules\Reference\Exceptions\RateNotFound;
use Brick\Math\BigDecimal;
use DateTimeImmutable;

/**
 * Unrealized FX differences of revaluable foreign-currency accounts at the end of a period:
 * foreign balance x rate (rounded to the currency scale) minus the book balance. Posting books one
 * revaluation entry against fx.gain / fx.loss (per currency) on the period's last day and its
 * automatic reversal on the first day of the next period.
 */
final class FxRevaluation
{
    public const string SOURCE = 'fx_revaluation';

    public function __construct(
        private readonly LedgerPoster $poster,
        private readonly Periods $periods,
        private readonly BalanceBook $balances,
        private readonly ExchangeRateProvider $rates,
        private readonly AccountDeterminer $determiner,
        private readonly AccountingSettings $settings,
    ) {}

    /**
     * @return array{period_id: string, rate_date: string, base_currency: string, dry_run: bool, lines: list<array<string, string>>, total_gain: string, total_loss: string, entry: array{id: string, number: string|null}|null, reversal: array{id: string, number: string|null}|null}
     */
    public function run(AccountingPeriod $period, DateTimeImmutable $rateDate, bool $dryRun, ?string $actor): array
    {
        $base = $this->settings->baseCurrency();
        $asOf = new DateTimeImmutable($period->end_date->format('Y-m-d'));
        $items = [];
        $gain = BigDecimal::zero()->toScale(4);
        $loss = BigDecimal::zero()->toScale(4);

        $accounts = Account::query()->where('is_revaluable', true)->where('is_postable', true)
            ->whereNotNull('currency_code')->where('currency_code', '<>', $base)->orderBy('code')->get();

        foreach ($accounts as $account) {
            $currency = (string) $account->currency_code;
            $balance = $this->balances->accountAsOf($account->id, $asOf, $currency);
            $fx = $balance['fx_balance'] ?? BigDecimal::zero();

            try {
                $rate = BigDecimal::of($this->rates->rate($currency, $base, $rateDate));
            } catch (RateNotFound) {
                Messages::fail('rate_date', 'rate_missing', ['currency' => $currency, 'date' => $rateDate->format('Y-m-d')]);
            }

            $revalued = RoundingPolicy::currency($fx->multipliedBy($rate))->toScale(4);
            $difference = $revalued->minus($balance['balance']);
            if ($difference->isPositive()) {
                $gain = $gain->plus($difference);
            } else {
                $loss = $loss->plus($difference->abs());
            }

            $items[] = [
                'account' => $account,
                'difference' => $difference,
                'row' => [
                    'account_id' => $account->id,
                    'account_code' => $account->code,
                    'account_name' => $account->name,
                    'currency_code' => $currency,
                    'fx_balance' => (string) $fx,
                    'rate' => (string) $rate,
                    'book_balance' => (string) $balance['balance'],
                    'revalued_balance' => (string) $revalued,
                    'difference' => (string) $difference,
                ],
            ];
        }

        $result = [
            'period_id' => $period->id,
            'rate_date' => $rateDate->format('Y-m-d'),
            'base_currency' => $base,
            'dry_run' => $dryRun,
            'lines' => array_map(static fn (array $i): array => $i['row'], $items),
            'total_gain' => (string) $gain,
            'total_loss' => (string) $loss,
            'entry' => null,
            'reversal' => null,
        ];

        if ($dryRun) {
            return $result;
        }

        $changed = array_values(array_filter($items, static fn (array $i): bool => ! $i['difference']->isZero()));

        if ($changed === []) {
            Messages::fail('period_id', 'fx_nothing_to_post');
        }

        return Ledger::transaction(function () use ($period, $rateDate, $actor, $changed, $result): array {
            $period = AccountingPeriod::query()->with('fiscalYear')->whereKey($period->id)->firstOrFail();
            $this->periods->assertPostable($period);
            $next = $this->periods->next($period) ?? Messages::fail('period_id', 'next_period_missing');
            $next->load('fiscalYear');
            $this->periods->assertPostable($next);

            $key = self::SOURCE.'|'.$period->id.'|rate:'.$rateDate->format('Y-m-d');
            Ledger::lock('post.'.hash('sha256', $key));
            $entry = JournalEntry::query()->where('posting_key', $key)->where('status', '<>', EntryStatus::Draft->value)->first();

            if ($entry === null) {
                $entry = $this->poster->book($this->lines($changed), [
                    'entry_type' => EntryType::Revaluation,
                    'entry_date' => $period->end_date->format('Y-m-d'),
                    'description' => Messages::get('fx_revaluation_description', ['date' => $rateDate->format('Y-m-d')]),
                    'source_type' => self::SOURCE,
                    'source_id' => $period->id,
                    'posting_key' => $key,
                ], $actor, false, $period->id, strict: false);
            }

            $reversal = $entry->reversed_by_id !== null
                ? JournalEntry::query()->findOrFail($entry->reversed_by_id)
                : $this->poster->reverseEntry($entry->id, new DateTimeImmutable($next->start_date->format('Y-m-d')), Messages::get('fx_auto_reversal'), $actor, periodId: $next->id);

            $result['entry'] = ['id' => $entry->id, 'number' => $entry->number];
            $result['reversal'] = ['id' => $reversal->id, 'number' => $reversal->number];

            return $result;
        });
    }

    /**
     * @param  list<array{account: Account, difference: BigDecimal, row: array<string, string>}>  $items
     * @return list<LineInput>
     */
    private function lines(array $items): array
    {
        $lines = [];
        /** @var array<string, array{gain: BigDecimal, loss: BigDecimal}> $perCurrency */
        $perCurrency = [];
        $zero = BigDecimal::zero()->toScale(4);

        foreach ($items as $item) {
            $d = $item['difference'];
            $currency = (string) $item['account']->currency_code;
            $perCurrency[$currency] ??= ['gain' => $zero, 'loss' => $zero];
            if ($d->isPositive()) {
                $lines[] = new LineInput($item['account'], $d, $zero);
                $perCurrency[$currency]['gain'] = $perCurrency[$currency]['gain']->plus($d);
            } else {
                $lines[] = new LineInput($item['account'], $zero, $d->abs());
                $perCurrency[$currency]['loss'] = $perCurrency[$currency]['loss']->plus($d->abs());
            }
        }

        foreach ($perCurrency as $currency => $totals) {
            if ($totals['gain']->isPositive()) {
                $lines[] = new LineInput($this->target('fx.gain', $currency), $zero, $totals['gain']);
            }

            if ($totals['loss']->isPositive()) {
                $lines[] = new LineInput($this->target('fx.loss', $currency), $totals['loss'], $zero);
            }
        }

        return $lines;
    }

    private function target(string $event, string $currency): Account
    {
        $ref = $this->determiner->resolve($event, ['currency' => $currency]);

        return Account::query()->findOrFail($ref->id);
    }
}
