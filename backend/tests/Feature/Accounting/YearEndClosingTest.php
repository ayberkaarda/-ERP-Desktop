<?php

declare(strict_types=1);

use App\Modules\Accounting\Enums\EntryType;
use App\Modules\Accounting\Enums\ExpenseScheme;
use App\Modules\Accounting\Exceptions\PeriodNotOpen;
use App\Modules\Accounting\Models\AccountingPeriod;
use App\Modules\Accounting\Models\FiscalYear;
use App\Modules\Accounting\Models\JournalEntry;
use App\Modules\Accounting\Services\ChartSeeder;
use App\Modules\Accounting\Services\FiscalCalendar;
use App\Modules\Accounting\Services\JournalDrafts;
use App\Modules\Accounting\Services\PeriodStatusService;
use App\Modules\Accounting\Services\YearEndClosing;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\Accounting\Books;
use Tests\Support\Actors;
use Tests\Support\Companies;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Books::boot();
    $this->company = Books::company();
    $this->closer = Actors::user(['accounting.year.close', 'accounting.entries.view', 'accounting.entries.reverse']);
    $this->party = Books::$parties[0];
    $this->year = Books::fiscalYear($this->company, '2027');
});

/**
 * Worked example (amounts in TRY):
 *   opening capital 10,000 cash; purchase goods 8,000 + VAT 1,440 on account; sale 10,000 + VAT 1,800
 *   on account with cost of goods sold 6,000; general expenses 1,500 paid in cash; tax provision 400.
 *   Result before tax 2,500 (690), net result 2,100 (692) -> 590 Dönem Net Kârı.
 */
function workedExample(string $company, string $party): void
{
    Books::post($company, '2027-01-02', [['100', '10000', '0'], ['500', '0', '10000']], EntryType::Opening);
    Books::post($company, '2027-02-10', [['153', '8000', '0'], ['191', '1440', '0'], ['320', '0', '9440', ['partyId' => $party]]]);
    Books::post($company, '2027-03-15', [['120', '11800', '0', ['partyId' => $party]], ['600', '0', '10000'], ['391', '0', '1800']]);
    Books::post($company, '2027-03-15', [['621', '6000', '0'], ['153', '0', '6000']]);
    Books::post($company, '2027-04-20', [['770', '1500', '0'], ['100', '0', '1500']]);
    Books::post($company, '2027-12-31', [['691', '400', '0'], ['360', '0', '400']]);
}

/** @return array<string, string> code => debit-positive balance */
function balancesAt(string $company, string $date, array $codes): array
{
    return collect($codes)->mapWithKeys(fn (string $c): array => [$c => Books::balance($company, $c, $date)])->all();
}

it('closes the year: income statement to 690, 692 to 590, balance sheet carried into the next year', function (): void {
    workedExample($this->company, $this->party);

    Books::postJson($this->closer, $this->company, "fiscal-years/{$this->year->id}/close")
        ->assertOk()->assertJsonPath('data.status', 'closed')->assertJsonPath('data.periods.11.status', 'closed');

    $generated = Books::in($this->company, fn () => JournalEntry::query()->with('lines.account')->where('source_type', 'fiscal_year')->orderBy('posted_at')->orderBy('number')->get());
    $lines = fn (JournalEntry $e): array => $e->lines->map(fn ($l): string => "{$l->account->code} {$l->debit}/{$l->credit}")->all();

    expect($generated->pluck('entry_type')->map->value->all())->toBe(['closing', 'closing', 'closing', 'closing', 'opening'])
        ->and($generated->pluck('number')->all())->toBe(['2027000000007', '2027000000008', '2027000000009', '2027000000010', '2028000000001'])
        ->and($lines($generated[0]))->toBe(['600 10000.0000/0.0000', '621 0.0000/6000.0000', '770 0.0000/1500.0000', '690 0.0000/2500.0000'])
        ->and($lines($generated[1]))->toBe(['690 2500.0000/0.0000', '691 0.0000/400.0000', '692 0.0000/2100.0000'])
        ->and($lines($generated[2]))->toBe(['692 2100.0000/0.0000', '590 0.0000/2100.0000'])
        ->and($generated[3]->entry_date->format('Y-m-d'))->toBe('2027-12-31')
        ->and($generated[4]->entry_date->format('Y-m-d'))->toBe('2028-01-01');

    $codes = ['100', '120', '153', '191', '320', '360', '391', '500', '590', '600', '621', '690', '691', '692', '770'];

    // At year end every account is closed.
    expect(array_unique(array_values(balancesAt($this->company, '2027-12-31', $codes))))->toBe(['0.0000']);

    // The next year opens with the balance sheet, profit in 590.
    expect(balancesAt($this->company, '2028-01-01', $codes))->toBe([
        '100' => '8500.0000', '120' => '11800.0000', '153' => '2000.0000', '191' => '1440.0000',
        '320' => '-9440.0000', '360' => '-400.0000', '391' => '-1800.0000', '500' => '-10000.0000',
        '590' => '-2100.0000', '600' => '0.0000', '621' => '0.0000', '690' => '0.0000', '691' => '0.0000', '692' => '0.0000', '770' => '0.0000',
    ]);

    $next = Books::fiscalYear($this->company, '2028');
    expect($next->status->value)->toBe('open')
        ->and(Books::in($this->company, fn () => AccountingPeriod::query()->where('fiscal_year_id', $next->id)->count()))->toBe(12)
        ->and(Books::in($this->company, fn () => AccountingPeriod::query()->where('fiscal_year_id', $this->year->id)->where('status', '<>', 'closed')->count()))->toBe(0);

    [$stored, $computed] = Books::balanceSnapshots($this->company);
    expect($stored)->toEqual($computed);

    // The closed year takes no more postings, and its generated entries cannot be reversed by hand.
    expect(fn () => Books::post($this->company, '2027-06-01', [['100', '1', '0'], ['500', '0', '1']]))->toThrow(PeriodNotOpen::class);
    Books::postJson($this->closer, $this->company, "journal-entries/{$generated[4]->id}/reverse", ['date' => '2028-01-02', 'reason' => 'undo'])
        ->assertStatus(422)->assertJsonValidationErrors(['entry'], 'errors.fields');
    Books::postJson($this->closer, $this->company, "fiscal-years/{$this->year->id}/close")->assertStatus(422);
});

it('carries a loss into 591', function (): void {
    Books::post($this->company, '2027-01-02', [['100', '10000', '0'], ['500', '0', '10000']], EntryType::Opening);
    Books::post($this->company, '2027-05-02', [['770', '3000', '0'], ['100', '0', '3000']]);

    Books::postJson($this->closer, $this->company, "fiscal-years/{$this->year->id}/close")->assertOk();

    expect(balancesAt($this->company, '2028-01-01', ['100', '500', '590', '591', '770']))->toBe([
        '100' => '7000.0000', '500' => '-10000.0000', '590' => '0.0000', '591' => '3000.0000', '770' => '0.0000',
    ]);
});

it('reopens a year by reversing its closing and opening entries, and closes it again', function (): void {
    workedExample($this->company, $this->party);
    Books::postJson($this->closer, $this->company, "fiscal-years/{$this->year->id}/close")->assertOk();

    Books::postJson($this->closer, $this->company, "fiscal-years/{$this->year->id}/reopen", [])
        ->assertStatus(422)->assertJsonValidationErrors(['reason'], 'errors.fields');
    $reopened = Books::postJson($this->closer, $this->company, "fiscal-years/{$this->year->id}/reopen", ['reason' => 'late supplier invoice'])
        ->assertOk()->assertJsonPath('data.status', 'open')->json('data');

    expect(collect($reopened['periods'])->pluck('status', 'number')->all())->toMatchArray([11 => 'closed', 12 => 'open'])
        ->and(Books::in($this->company, fn () => JournalEntry::query()->where('source_type', 'fiscal_year')->where('status', 'reversed')->count()))->toBe(5)
        ->and(Books::in($this->company, fn () => JournalEntry::query()->where('entry_type', 'reversal')->where('reversal_reason', 'late supplier invoice')->count()))->toBe(5)
        ->and(balancesAt($this->company, '2028-01-01', ['100', '590', '600']))->toBe(['100' => '8500.0000', '590' => '0.0000', '600' => '-10000.0000']);

    Books::post($this->company, '2027-12-20', [['770', '100', '0'], ['100', '0', '100']]);
    Books::postJson($this->closer, $this->company, "fiscal-years/{$this->year->id}/close")->assertOk();

    expect(balancesAt($this->company, '2028-01-01', ['100', '590', '600', '770']))->toBe(['100' => '8400.0000', '590' => '-2000.0000', '600' => '0.0000', '770' => '0.0000']);
    [$stored, $computed] = Books::balanceSnapshots($this->company);
    expect($stored)->toEqual($computed);

    // A second reopening reverses only the second run, never the first run's reversals.
    Books::postJson($this->closer, $this->company, "fiscal-years/{$this->year->id}/reopen", ['reason' => 'second correction'])->assertOk();

    expect(Books::in($this->company, fn () => JournalEntry::query()->where('entry_type', 'reversal')->where('reversal_reason', 'second correction')->count()))->toBe(5)
        ->and(Books::in($this->company, fn () => JournalEntry::query()->where('entry_type', 'reversal')->where('status', 'reversed')->count()))->toBe(0)
        ->and(balancesAt($this->company, '2027-12-31', ['100', '590', '600', '690', '770']))->toBe(['100' => '8400.0000', '590' => '0.0000', '600' => '-10000.0000', '690' => '0.0000', '770' => '1600.0000'])
        ->and(balancesAt($this->company, '2028-01-01', ['100', '590', '600', '770']))->toBe(['100' => '8400.0000', '590' => '0.0000', '600' => '-10000.0000', '770' => '1600.0000']);

    Books::postJson($this->closer, $this->company, "fiscal-years/{$this->year->id}/close")->assertOk();
    expect(balancesAt($this->company, '2028-01-01', ['100', '590', '600', '770']))->toBe(['100' => '8400.0000', '590' => '-2000.0000', '600' => '0.0000', '770' => '0.0000']);
    [$stored, $computed] = Books::balanceSnapshots($this->company);
    expect($stored)->toEqual($computed);
});

it('requires the previous year closed, no drafts, and an open closing period', function (): void {
    Books::year($this->company, '2026');
    Books::postJson($this->closer, $this->company, "fiscal-years/{$this->year->id}/close")
        ->assertStatus(422)->assertJsonValidationErrors(['status'], 'errors.fields');

    $other = Books::company();
    $year = Books::fiscalYear($other, '2027');
    Books::in($other, fn () => app(JournalDrafts::class)->create([
        'entry_type' => 'general', 'entry_date' => '2027-05-01', 'lines' => [['account_code' => '100', 'debit' => '1']],
    ], null));
    $closer = Actors::user(['accounting.year.close'], $other);
    Books::postJson($closer, $other, "fiscal-years/{$year->id}/close")->assertStatus(422)->assertJsonValidationErrors(['status'], 'errors.fields');

    $third = Books::company();
    $year = Books::fiscalYear($third, '2027');
    Books::in($third, fn () => app(PeriodStatusService::class)->close(Books::period($third, '2027', 12), null));
    Books::postJson(Actors::user(['accounting.year.close'], $third), $third, "fiscal-years/{$year->id}/close")->assertStatus(422);
});

it('books the closing into the adjustment period 13 even when period 12 is closed', function (): void {
    $company = Companies::make();
    Books::in($company, function (): void {
        app(ChartSeeder::class)->seed(ExpenseScheme::A);
        app(FiscalCalendar::class)->create(['code' => '2027', 'start_date' => '2027-01-01', 'adjustment_period' => true]);
    });
    Books::post($company, '2027-01-02', [['100', '500', '0'], ['600', '0', '500']]);
    Books::in($company, fn () => app(PeriodStatusService::class)->close(Books::period($company, '2027', 12), null));

    $year = Books::in($company, fn () => app(YearEndClosing::class)->close(FiscalYear::query()->firstOrFail(), null));
    $thirteen = Books::period($company, '2027', 13);
    $closing = Books::in($company, fn () => JournalEntry::query()->where('entry_type', 'closing')->get());

    expect($year->status->value)->toBe('closed')
        ->and($closing->pluck('period_id')->unique()->all())->toBe([$thirteen->id])
        ->and(Books::in($company, fn () => AccountingPeriod::query()->where('fiscal_year_id', Books::fiscalYear($company, '2028')->id)->where('number', 13)->exists()))->toBeTrue()
        ->and(Books::balance($company, '590', '2028-01-01'))->toBe('-500.0000');
});

it('refuses to reopen a year whose following year is closed', function (): void {
    Books::post($this->company, '2027-01-02', [['100', '100', '0'], ['500', '0', '100']], EntryType::Opening);
    Books::postJson($this->closer, $this->company, "fiscal-years/{$this->year->id}/close")->assertOk();
    $next = Books::fiscalYear($this->company, '2028');
    Books::postJson($this->closer, $this->company, "fiscal-years/{$next->id}/close")->assertOk();

    Books::postJson($this->closer, $this->company, "fiscal-years/{$this->year->id}/reopen", ['reason' => 'x'])
        ->assertStatus(422)->assertJsonValidationErrors(['status'], 'errors.fields');
    Books::postJson($this->closer, $this->company, "fiscal-years/{$next->id}/reopen", ['reason' => 'x'])->assertOk();
});

it('needs accounting.year.close for closing and reopening', function (): void {
    $user = Actors::user(['accounting.periods.manage', 'accounting.periods.close', 'accounting.periods.reopen']);

    Books::postJson($user, $this->company, "fiscal-years/{$this->year->id}/close")->assertForbidden();
    Books::postJson($user, $this->company, "fiscal-years/{$this->year->id}/reopen", [])->assertForbidden();
    Books::postJson($this->closer, Books::company(), "fiscal-years/{$this->year->id}/close")->assertForbidden();
    expect(Books::fiscalYear($this->company, '2027')->status->value)->toBe('open');
});

it('previews the closing without writing anything', function (): void {
    workedExample($this->company, $this->party);
    $before = Books::in($this->company, fn (): int => JournalEntry::query()->count());

    $preview = Books::as($this->closer, $this->company)->getJson("/api/v1/fiscal-years/{$this->year->id}/close-preview")
        ->assertOk()
        ->assertJsonPath('data.result', '2100.0000')
        ->assertJsonPath('data.result_side', 'credit')
        ->assertJsonPath('data.result_account_code', '590')
        ->assertJsonPath('data.warnings', [])
        ->json('data.entries');

    expect(collect($preview)->pluck('entry_type')->all())->toBe(['closing', 'closing', 'closing', 'closing', 'opening'])
        ->and($preview[0])->toMatchArray(['entry_date' => '2027-12-31', 'line_count' => 4, 'total_debit' => '10000.0000', 'total_credit' => '10000.0000'])
        ->and($preview[4]['entry_date'])->toBe('2028-01-01')
        ->and($preview[4]['total_debit'])->toBe($preview[3]['total_credit'])
        ->and(Books::in($this->company, fn (): int => JournalEntry::query()->count()))->toBe($before)
        ->and(Books::in($this->company, fn (): bool => FiscalYear::query()->where('code', '2028')->exists()))->toBeFalse()
        ->and(Books::fiscalYear($this->company, '2027')->status->value)->toBe('open');
});

it('reports blocking conditions of the closing preview as warnings and needs accounting.year.close', function (): void {
    Books::year($this->company, '2026');
    Books::in($this->company, fn () => app(JournalDrafts::class)->create([
        'entry_type' => 'general', 'entry_date' => '2027-05-01', 'lines' => [['account_code' => '100', 'debit' => '1']],
    ], null));

    Books::as($this->closer, $this->company)->getJson("/api/v1/fiscal-years/{$this->year->id}/close-preview")
        ->assertOk()
        ->assertJsonPath('data.warnings', [
            __('accounting::messages.previous_year_open', ['year' => '2026']),
            __('accounting::messages.year_has_drafts'),
        ])
        ->assertJsonPath('data.entries', []);

    $viewer = Actors::user(['accounting.periods.view', 'accounting.periods.manage']);
    Books::as($viewer, $this->company)->getJson("/api/v1/fiscal-years/{$this->year->id}/close-preview")->assertForbidden();
});
