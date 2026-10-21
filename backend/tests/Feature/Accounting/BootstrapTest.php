<?php

declare(strict_types=1);

use App\Modules\Accounting\Models\Account;
use App\Modules\Accounting\Models\AccountDeterminationRule;
use App\Modules\Accounting\Models\AccountingPeriod;
use App\Modules\Accounting\Models\FiscalYear;
use App\Modules\Accounting\Services\AccountingBootstrap;
use App\Modules\Accounting\Support\AccountingSettings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Support\Accounting\Books;
use Tests\Support\Actors;
use Tests\Support\Companies;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Books::boot();
});

function ledgerCounts(string $company): array
{
    return Books::in($company, fn (): array => [
        'accounts' => Account::query()->count(),
        'rules' => AccountDeterminationRule::query()->count(),
        'years' => FiscalYear::query()->count(),
        'periods' => AccountingPeriod::query()->count(),
    ]);
}

it('bootstraps a new company from the chart template on CompanyCreated', function (): void {
    $company = Books::company();

    // 45 template rows: one invalid, two of the 7/B layout.
    expect(ledgerCounts($company))->toBe(['accounts' => 42, 'rules' => 17, 'years' => 1, 'periods' => 12]);

    $cash = Books::account($company, '100');
    $group = Books::account($company, '10');
    expect($cash->is_system)->toBeTrue()->and($cash->level)->toBe(3)->and($cash->parent_id)->toBe($group->id)
        ->and($group->is_postable)->toBeFalse()->and($cash->is_postable)->toBeTrue()
        ->and(Books::account($company, '120')->requires_party)->toBeTrue()
        ->and(Books::account($company, '591')->normal_balance->value)->toBe('debit')
        ->and(Books::in($company, fn () => Account::query()->where('code', '793')->exists()))->toBeFalse()
        ->and(Books::fiscalYear($company, '2027')->end_date->format('Y-m-d'))->toBe('2027-12-31');

    expect(Books::in($company, fn () => app(AccountingSettings::class)->expenseScheme()->value))->toBe('7A')
        ->and(Books::in($company, fn () => app(AccountingSettings::class)->closingMapping()['result_account']))->toBe('690');
});

it('is idempotent and adds only what is missing', function (): void {
    $company = Books::company();
    $before = ledgerCounts($company);

    $again = app(AccountingBootstrap::class)->run($company);
    expect($again)->toMatchArray(['accounts_created' => 0, 'accounts_skipped' => 42, 'accounts_invalid' => 1, 'rules_created' => 0, 'fiscal_year_created' => null])
        ->and(ledgerCounts($company))->toBe($before);

    $this->artisan('accounting:seed-chart', ['company' => $company, '--scheme' => '7b'])->assertSuccessful();
    expect(Books::in($company, fn () => Account::query()->whereIn('code', ['79', '793'])->count()))->toBe(2)
        ->and(ledgerCounts($company)['rules'])->toBe(17);
});

it('seeds an existing company through the command with the 7/B layout', function (): void {
    $company = Companies::make();

    $this->artisan('accounting:seed-chart', ['company' => $company, '--scheme' => '7B'])
        ->expectsTable(['key', 'value'], [
            ['accounts_created', '42'], ['accounts_skipped', '0'], ['accounts_invalid', '1'], ['chart_available', 'yes'],
            ['rules_created', '16'], ['fiscal_year_created', '2027'],
        ])
        ->assertSuccessful();

    $expense = Books::in($company, fn () => AccountDeterminationRule::query()->with('account')->where('event_key', 'purchase.expense')->firstOrFail());
    expect($expense->account->code)->toBe('793')
        ->and(Books::in($company, fn () => Account::query()->where('code', '770')->exists()))->toBeFalse();
});

it('rejects unknown companies and schemes, and warns when the template is missing', function (): void {
    $this->artisan('accounting:seed-chart', ['company' => '01900000-0000-7000-8000-000000000000'])->assertFailed();
    $this->artisan('accounting:seed-chart', ['company' => 'nope'])->assertFailed();

    $company = Companies::make();
    $this->artisan('accounting:seed-chart', ['company' => $company, '--scheme' => '7C'])->assertFailed();

    config(['accounting.chart_path' => base_path('tests/Fixtures/Accounting/missing.json')]);
    $this->artisan('accounting:seed-chart', ['company' => $company])
        ->expectsOutputToContain('not found')
        ->assertSuccessful();
    expect(ledgerCounts($company))->toBe(['accounts' => 0, 'rules' => 0, 'years' => 1, 'periods' => 12]);
});

it('can be switched off for new companies', function (): void {
    config(['accounting.bootstrap_on_company_created' => false]);
    $company = Actors::company();

    expect(ledgerCounts($company))->toBe(['accounts' => 0, 'rules' => 0, 'years' => 0, 'periods' => 0]);
});

it('rebuilds account balances from the booked lines', function (): void {
    $company = Books::company();
    Books::post($company, '2027-02-02', [['100', '10', '0'], ['600', '0', '10']]);
    Books::post($company, '2027-03-02', [['100', '5', '0'], ['600', '0', '5']]);
    DB::table('account_balances')->where('company_id', $company)->update(['debit_total' => '999']);

    $this->artisan('accounting:rebuild-balances', ['company' => $company])->assertSuccessful();

    [$stored, $computed] = Books::balanceSnapshots($company);
    expect($stored)->toEqual($computed)->and($stored)->toHaveCount(4);
    $this->artisan('accounting:rebuild-balances', ['company' => 'nope'])->assertFailed();
    $this->artisan('accounting:rebuild-balances')->assertSuccessful();
});
