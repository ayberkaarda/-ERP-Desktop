<?php

declare(strict_types=1);

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Arr;
use Tests\Support\Accounting\Books;
use Tests\Support\Accounting\ReportBooks;
use Tests\Support\Actors;
use Tests\Support\Identity;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Books::boot();
    $this->company = Books::company();
    ReportBooks::seed($this->company);
    $this->account = Books::account($this->company, '100')->id;
    $this->party = Books::$parties[1];
});

dataset('report endpoints', [
    'trial balance' => ['trial-balance'],
    'trial balance export' => ['trial-balance/export'],
    'general ledger' => ['general-ledger'],
    'general ledger export' => ['general-ledger/export'],
    'journal book' => ['journal-book'],
    'journal book export' => ['journal-book/export'],
    'account statement' => ['account-statement'],
    'account statement export' => ['account-statement/export'],
]);

function reportQuery(string $uri, string $account, string $party): string
{
    $params = ['date_from' => '2027-01-01', 'date_to' => '2027-12-31'];

    if (str_starts_with($uri, 'general-ledger')) {
        $params['account_id'] = $account;
    }

    if (str_starts_with($uri, 'account-statement')) {
        $params['party_id'] = $party;
    }

    return '/api/v1/reports/'.$uri.'?'.Arr::query($params);
}

it('needs accounting.reports.view, checked before validation', function (string $uri): void {
    $without = Actors::user(array_values(array_diff(Books::ALL, ['accounting.reports.view'])), $this->company);
    $with = Actors::user(['accounting.reports.view'], $this->company);

    // No parameters at all: the caller without permission sees 403, not the validation details.
    Books::as($without, $this->company)->getJson('/api/v1/reports/'.$uri)->assertForbidden();
    Books::as($without, $this->company)->getJson(reportQuery($uri, $this->account, $this->party))->assertForbidden();
    Books::as($with, $this->company)->getJson('/api/v1/reports/'.$uri)->assertStatus(422);
    Books::as($with, $this->company)->getJson(reportQuery($uri, $this->account, $this->party))->assertOk();
})->with('report endpoints');

it('requires authentication and membership of the requested company', function (string $uri): void {
    Identity::fresh();
    $this->getJson(reportQuery($uri, $this->account, $this->party), ['X-Company-Id' => $this->company, 'Accept' => 'application/json'])->assertUnauthorized();

    $other = Books::company();
    $outsider = Actors::user(['accounting.reports.view'], $other);
    Books::as($outsider, $this->company)->getJson(reportQuery($uri, $this->account, $this->party))->assertForbidden();
})->with('report endpoints');

it('keeps every report inside the active company', function (): void {
    $other = Books::company();
    Books::post($other, '2027-02-10', [['100', '777.00', '0'], ['120', '0', '777.00', ['partyId' => $this->party]]]);
    $user = Actors::user(['accounting.reports.view'], $this->company);
    Actors::grant($user, $other, ['accounting.reports.view']);
    $get = fn (string $company, string $uri) => Books::as($user, $company)->getJson('/api/v1/reports/'.$uri);

    $mine = $get($this->company, 'trial-balance?date_from=2027-01-01&date_to=2027-12-31')->json('data.totals.debit');
    $theirs = $get($other, 'trial-balance?date_from=2027-01-01&date_to=2027-12-31')->json('data.totals.debit');
    expect($mine)->toBe('20600.0000')->and($theirs)->toBe('777.0000');

    $book = $get($this->company, 'journal-book?date_from=2027-01-01&date_to=2027-12-31')->json('meta.pagination.total');
    expect($book)->toBe(6);

    $statement = $get($this->company, "account-statement?party_id={$this->party}&date_from=2027-01-01&date_to=2027-12-31")->json('meta.totals');
    expect($statement)->toBe(['debit' => '3600.0000', 'credit' => '3600.0000']);

    // Ids of the other company are not found here.
    $get($this->company, 'general-ledger?date_from=2027-01-01&date_to=2027-12-31&account_id='.Books::account($other, '100')->id)->assertNotFound();
    $get($this->company, 'trial-balance?period_id='.Books::period($other, '2027', 2)->id)->assertNotFound();
    $get($this->company, 'journal-book/export?period_id='.Books::period($other, '2027', 2)->id)->assertNotFound();
});

it('lets the default Accountant and Viewer roles read reports, but not Sales', function (): void {
    $company = Identity::company([], true);
    $query = '/api/v1/reports/trial-balance?date_from=2027-01-01&date_to=2027-12-31';

    foreach (['Accountant' => 200, 'Viewer' => 200, 'Sales' => 403] as $role => $status) {
        Books::as(Identity::member($company, [$role]), $company->id)->getJson($query)->assertStatus($status);
    }
});
