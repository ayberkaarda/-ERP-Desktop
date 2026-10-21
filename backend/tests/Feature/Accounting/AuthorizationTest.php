<?php

declare(strict_types=1);

use App\Models\User;
use App\Modules\Accounting\Models\AccountDeterminationRule;
use App\Modules\Accounting\Services\JournalDrafts;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;
use Tests\Support\Accounting\Books;
use Tests\Support\Actors;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Books::boot();
    $this->company = Books::company();
    $this->ids = [
        '{year}' => Books::fiscalYear($this->company, '2027')->id,
        '{period}' => Books::period($this->company, '2027', 5)->id,
        '{account}' => Books::account($this->company, '100')->id,
        '{entry}' => Books::in($this->company, fn () => app(JournalDrafts::class)->create([
            'entry_type' => 'general', 'entry_date' => '2027-05-05', 'lines' => [['account_code' => '100', 'debit' => '1']],
        ], null))->id,
        '{rule}' => Books::in($this->company, fn () => AccountDeterminationRule::query()->firstOrFail())->id,
    ];
});

dataset('accounting endpoints', [
    'list years' => ['GET', 'fiscal-years', ['accounting.periods.view', 'accounting.periods.manage']],
    'show year' => ['GET', 'fiscal-years/{year}', ['accounting.periods.view', 'accounting.periods.manage']],
    'create year' => ['POST', 'fiscal-years', ['accounting.periods.manage']],
    'update year' => ['PATCH', 'fiscal-years/{year}', ['accounting.periods.manage']],
    'close year' => ['POST', 'fiscal-years/{year}/close', ['accounting.year.close']],
    'reopen year' => ['POST', 'fiscal-years/{year}/reopen', ['accounting.year.close']],
    'list periods' => ['GET', 'accounting-periods', ['accounting.periods.view', 'accounting.periods.manage', 'accounting.periods.close']],
    'show period' => ['GET', 'accounting-periods/{period}', ['accounting.periods.view', 'accounting.periods.manage', 'accounting.periods.close']],
    'soft-close period' => ['POST', 'accounting-periods/{period}/soft-close', ['accounting.periods.close']],
    'close period' => ['POST', 'accounting-periods/{period}/close', ['accounting.periods.close']],
    'reopen period' => ['POST', 'accounting-periods/{period}/reopen', ['accounting.periods.reopen']],
    'list accounts' => ['GET', 'accounts', ['accounting.accounts.view', 'accounting.accounts.manage']],
    'account tree' => ['GET', 'accounts/tree', ['accounting.accounts.view', 'accounting.accounts.manage']],
    'show account' => ['GET', 'accounts/{account}', ['accounting.accounts.view', 'accounting.accounts.manage']],
    'account balance' => ['GET', 'accounts/{account}/balance', ['accounting.accounts.view', 'accounting.accounts.manage']],
    'create account' => ['POST', 'accounts', ['accounting.accounts.manage']],
    'update account' => ['PATCH', 'accounts/{account}', ['accounting.accounts.manage']],
    'delete account' => ['DELETE', 'accounts/{account}', ['accounting.accounts.manage']],
    'import accounts' => ['POST', 'accounts/import', ['accounting.accounts.manage']],
    'list entries' => ['GET', 'journal-entries', ['accounting.entries.view']],
    'export entries' => ['GET', 'journal-entries/export', ['accounting.entries.view']],
    'show entry' => ['GET', 'journal-entries/{entry}', ['accounting.entries.view']],
    'create entry' => ['POST', 'journal-entries', ['accounting.entries.create']],
    'update entry' => ['PATCH', 'journal-entries/{entry}', ['accounting.entries.create']],
    'delete entry' => ['DELETE', 'journal-entries/{entry}', ['accounting.entries.create']],
    'post entry' => ['POST', 'journal-entries/{entry}/post', ['accounting.entries.post']],
    'reverse entry' => ['POST', 'journal-entries/{entry}/reverse', ['accounting.entries.reverse']],
    'list rules' => ['GET', 'account-determination-rules', ['accounting.determination.manage']],
    'show rule' => ['GET', 'account-determination-rules/{rule}', ['accounting.determination.manage']],
    'create rule' => ['POST', 'account-determination-rules', ['accounting.determination.manage']],
    'update rule' => ['PATCH', 'account-determination-rules/{rule}', ['accounting.determination.manage']],
    'delete rule' => ['DELETE', 'account-determination-rules/{rule}', ['accounting.determination.manage']],
    'test determination' => ['POST', 'account-determination/test', ['accounting.determination.manage']],
    'fx revaluation' => ['POST', 'fx-revaluations', ['accounting.revaluation.run']],
]);

it('lets exactly the listed permissions through, before validation', function (string $method, string $uri, array $allowed): void {
    $uri = '/api/v1/'.strtr($uri, $this->ids);
    // An empty body: a caller without permission must see 403, never the validation details.
    $call = fn (User $user) => Books::as($user, $this->company)->json($method, $uri, [], ['Idempotency-Key' => (string) Str::uuid7()]);

    $call(Actors::user(array_values(array_diff(Books::ALL, $allowed)), $this->company))->assertForbidden();

    foreach ($allowed as $permission) {
        expect($call(Actors::user([$permission], $this->company))->baseResponse->getStatusCode())->toBeIn([200, 201, 204, 422]);
    }
})->with('accounting endpoints');

it('requires authentication and membership of the company', function (): void {
    $user = Actors::user(Books::ALL, $this->company);
    $foreign = Books::company();

    Auth::forgetGuards();
    $this->withHeaders(['X-Company-Id' => $this->company])->getJson('/api/v1/accounts')->assertUnauthorized();
    Books::as($user, $foreign)->getJson('/api/v1/accounts')->assertForbidden()->assertJsonPath('errors.code', 'COMPANY_FORBIDDEN');
    Books::as($user, $this->company)->getJson('/api/v1/accounts')->assertOk();
});

it('answers 404 for records of a company the user can act in but that do not belong to it', function (string $method, string $uri): void {
    $other = Books::company();
    $user = Actors::user(Books::ALL, $this->company);
    $foreign = [
        '{year}' => Books::fiscalYear($other, '2027')->id,
        '{period}' => Books::period($other, '2027', 5)->id,
        '{account}' => Books::account($other, '100')->id,
        '{rule}' => Books::in($other, fn () => AccountDeterminationRule::query()->firstOrFail())->id,
    ];

    Books::as($user, $this->company)->json($method, '/api/v1/'.strtr($uri, $foreign), ['version' => 1, 'reason' => 'x', 'date' => '2027-05-06'], ['Idempotency-Key' => (string) Str::uuid7()])
        ->assertNotFound();
})->with([
    ['GET', 'fiscal-years/{year}'],
    ['PATCH', 'fiscal-years/{year}'],
    ['POST', 'fiscal-years/{year}/close'],
    ['POST', 'accounting-periods/{period}/soft-close'],
    ['POST', 'accounting-periods/{period}/reopen'],
    ['GET', 'accounts/{account}'],
    ['PATCH', 'accounts/{account}'],
    ['DELETE', 'accounts/{account}'],
    ['GET', 'account-determination-rules/{rule}'],
    ['PATCH', 'account-determination-rules/{rule}'],
    ['DELETE', 'account-determination-rules/{rule}'],
]);

it('lets super admins through without roles', function (): void {
    $root = User::factory()->superAdmin()->create();

    Books::as($root, $this->company)->getJson('/api/v1/journal-entries')->assertOk();
    Books::as($root, $this->company)->getJson('/api/v1/accounts/tree')->assertOk();
});
