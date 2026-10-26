<?php

declare(strict_types=1);

use App\Modules\Accounting\Models\JournalEntry;
use App\Modules\Accounting\Services\ChartOfAccounts;
use App\Modules\Reference\Contracts\ExchangeRateProvider;
use App\Modules\Reference\Exceptions\RateNotFound;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\Accounting\Books;
use Tests\Support\Actors;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Books::boot();
    $this->company = Books::company();
    $this->runner = Actors::user(['accounting.revaluation.run']);

    // USD per TRY fixing, through the Reference contract.
    app()->instance(ExchangeRateProvider::class, new class implements ExchangeRateProvider
    {
        public function rate(string $from, string $to, DateTimeInterface $date): string
        {
            $rates = ['USD|2027-03-31' => '38.000000', 'USD|2027-04-30' => '37.500000', 'USD|2027-12-31' => '40.000000'];

            return $rates[$from.'|'.$date->format('Y-m-d')] ?? throw new RateNotFound;
        }
    });

    Books::in($this->company, function (): void {
        $chart = app(ChartOfAccounts::class);
        $chart->create(['code' => '102.01', 'name' => 'USD bank', 'parent_code' => '102', 'currency_code' => 'USD', 'is_revaluable' => true]);
        $chart->create(['code' => '320.01', 'name' => 'USD supplier', 'parent_code' => '320', 'currency_code' => 'USD', 'is_revaluable' => true]);
        $chart->create(['code' => '102.02', 'name' => 'USD bank, not revalued', 'parent_code' => '102', 'currency_code' => 'USD']);
    });

    Books::post($this->company, '2027-03-05', [['102.01', '3500', '0', ['currency' => 'USD', 'fxAmount' => '100', 'fxRate' => '35']], ['500', '0', '3500']]);
    Books::post($this->company, '2027-03-20', [['153', '7200', '0'], ['320.01', '0', '7200', ['currency' => 'USD', 'fxAmount' => '200', 'fxRate' => '36']]]);
    Books::post($this->company, '2027-03-21', [['102.02', '360', '0', ['currency' => 'USD', 'fxAmount' => '10', 'fxRate' => '36']], ['500', '0', '360']]);
    $this->march = Books::period($this->company, '2027', 3);
});

it('previews the unrealized differences without booking anything', function (): void {
    $preview = Books::postJson($this->runner, $this->company, 'fx-revaluations', ['period_id' => $this->march->id, 'rate_date' => '2027-03-31'])
        ->assertOk()
        ->assertJsonPath('data.dry_run', true)
        ->assertJsonPath('data.base_currency', 'TRY')
        ->assertJsonPath('data.total_gain', '300.0000')
        ->assertJsonPath('data.total_loss', '400.0000')
        ->assertJsonPath('data.entry', null)
        ->json('data.lines');

    expect($preview)->toHaveCount(2)
        ->and($preview[0])->toMatchArray(['account_code' => '102.01', 'fx_balance' => '100.0000', 'rate' => '38.000000', 'book_balance' => '3500.0000', 'revalued_balance' => '3800.0000', 'difference' => '300.0000'])
        ->and($preview[1])->toMatchArray(['account_code' => '320.01', 'fx_balance' => '-200.0000', 'book_balance' => '-7200.0000', 'revalued_balance' => '-7600.0000', 'difference' => '-400.0000'])
        ->and(Books::in($this->company, fn () => JournalEntry::query()->where('entry_type', 'revaluation')->exists()))->toBeFalse();
});

it('books the revaluation against fx.gain / fx.loss and reverses it on the first day of the next period', function (): void {
    $result = Books::postJson($this->runner, $this->company, 'fx-revaluations', ['period_id' => $this->march->id, 'rate_date' => '2027-03-31', 'dry_run' => false])
        ->assertCreated()->json('data');

    $entry = Books::in($this->company, fn () => JournalEntry::query()->with('lines.account')->findOrFail($result['entry']['id']));
    $reversal = Books::in($this->company, fn () => JournalEntry::query()->findOrFail($result['reversal']['id']));

    expect($entry->entry_type->value)->toBe('revaluation')
        ->and($entry->entry_date->format('Y-m-d'))->toBe('2027-03-31')
        ->and($entry->status->value)->toBe('reversed')
        ->and($entry->lines->map(fn ($l) => "{$l->account->code} {$l->debit}/{$l->credit}")->all())
        ->toBe(['102.01 300.0000/0.0000', '320.01 0.0000/400.0000', '646 0.0000/300.0000', '656 400.0000/0.0000'])
        ->and($reversal->entry_date->format('Y-m-d'))->toBe('2027-04-01')
        ->and($reversal->reverses_id)->toBe($entry->id);

    expect(Books::balance($this->company, '102.01', '2027-03-31'))->toBe('3800.0000')
        ->and(Books::balance($this->company, '320.01', '2027-03-31'))->toBe('-7600.0000')
        ->and(Books::balance($this->company, '656', '2027-03-31'))->toBe('400.0000')
        ->and(Books::balance($this->company, '102.01', '2027-04-01'))->toBe('3500.0000')
        ->and(Books::balance($this->company, '646', '2027-04-01'))->toBe('0.0000');

    // Running it again for the same period and rate date books nothing new.
    $again = Books::postJson($this->runner, $this->company, 'fx-revaluations', ['period_id' => $this->march->id, 'rate_date' => '2027-03-31', 'dry_run' => false])
        ->assertCreated()->json('data');
    expect($again['entry']['id'])->toBe($result['entry']['id'])
        ->and($again['reversal']['id'])->toBe($result['reversal']['id'])
        ->and(Books::in($this->company, fn () => JournalEntry::query()->where('entry_type', 'revaluation')->count()))->toBe(1);

    [$stored, $computed] = Books::balanceSnapshots($this->company);
    expect($stored)->toEqual($computed);
});

it('refuses missing rates, a missing next period and nothing to post', function (): void {
    Books::postJson($this->runner, $this->company, 'fx-revaluations', ['period_id' => $this->march->id, 'rate_date' => '2027-03-30'])
        ->assertStatus(422)->assertJsonValidationErrors(['rate_date'], 'errors.fields');

    $december = Books::period($this->company, '2027', 12);
    Books::postJson($this->runner, $this->company, 'fx-revaluations', ['period_id' => $december->id, 'rate_date' => '2027-12-31', 'dry_run' => false])
        ->assertStatus(422)->assertJsonValidationErrors(['period_id'], 'errors.fields');

    // February has no foreign balances yet: nothing to book.
    $february = Books::period($this->company, '2027', 2);
    Books::postJson($this->runner, $this->company, 'fx-revaluations', ['period_id' => $february->id, 'rate_date' => '2027-03-31', 'dry_run' => false])
        ->assertStatus(422)->assertJsonValidationErrors(['period_id'], 'errors.fields');

    // March is revalued and reversed on April 1, so April starts again from the booked rates.
    Books::postJson($this->runner, $this->company, 'fx-revaluations', ['period_id' => $this->march->id, 'rate_date' => '2027-03-31', 'dry_run' => false])->assertCreated();
    $april = Books::period($this->company, '2027', 4);
    Books::postJson($this->runner, $this->company, 'fx-revaluations', ['period_id' => $april->id, 'rate_date' => '2027-04-30', 'dry_run' => false])
        ->assertCreated()->assertJsonPath('data.total_gain', '250.0000')->assertJsonPath('data.total_loss', '300.0000');
    expect(Books::balance($this->company, '102.01', '2027-04-30'))->toBe('3750.0000')
        ->and(Books::balance($this->company, '102.01', '2027-05-01'))->toBe('3500.0000');
});

it('needs accounting.revaluation.run and an open period of the company', function (): void {
    Books::postJson(Actors::user(['accounting.entries.post']), $this->company, 'fx-revaluations', ['period_id' => $this->march->id, 'rate_date' => '2027-03-31'])
        ->assertForbidden();
    Books::postJson(Actors::user(['accounting.entries.post'], $this->company), $this->company, 'fx-revaluations', [])->assertForbidden();

    $foreign = Books::period(Books::company(), '2027', 3);
    Books::postJson($this->runner, $this->company, 'fx-revaluations', ['period_id' => $foreign->id, 'rate_date' => '2027-03-31'])->assertNotFound();

    $this->march->forceFill(['status' => 'closed'])->save();
    Books::postJson($this->runner, $this->company, 'fx-revaluations', ['period_id' => $this->march->id, 'rate_date' => '2027-03-31', 'dry_run' => false])
        ->assertStatus(422)->assertJsonValidationErrors(['entry_date'], 'errors.fields');
});
