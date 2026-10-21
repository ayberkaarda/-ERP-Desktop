<?php

declare(strict_types=1);

use App\Modules\Accounting\Reports\Support\ReportExporter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\Accounting\Books;
use Tests\Support\Accounting\ReportBooks;
use Tests\Support\Actors;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Books::boot();
    $this->company = Books::company();
    ReportBooks::seed($this->company);
    $this->user = Actors::user(['accounting.reports.view'], $this->company);
    $this->get = fn (string $uri): TestResponse => Books::as($this->user, $this->company)->get('/api/v1/reports/'.$uri, ['Accept' => 'text/csv, application/json']);
});

/**
 * @return list<list<string>>
 */
function csvRows(TestResponse $response): array
{
    $body = (string) $response->streamedContent();
    expect(str_starts_with($body, "\xEF\xBB\xBF"))->toBeTrue();
    $lines = preg_split('/\r?\n/', trim(substr($body, 3))) ?: [];

    return array_map(fn (string $line): array => array_map('strval', str_getcsv($line, escape: '')), $lines);
}

it('exports the trial balance as CSV with totals and guarded text cells', function (): void {
    DB::table('accounts')->where('company_id', $this->company)->where('code', '600')->update(['name' => '=HYPERLINK("http://evil")']);

    $response = ($this->get)('trial-balance/export?date_from=2027-01-01&date_to=2027-12-31&compare_with_previous_year=1')->assertOk();
    expect($response->headers->get('Content-Type'))->toContain('text/csv');
    $rows = csvRows($response);
    $byCode = collect($rows)->keyBy(0);

    expect($rows[0])->toBe([
        'code', 'name', 'level', 'tdhp_group', 'opening_debit', 'opening_credit', 'debit', 'credit', 'total_debit', 'total_credit',
        'balance_debit', 'balance_credit', 'previous_debit', 'previous_credit', 'previous_balance_debit', 'previous_balance_credit',
    ])
        ->and($byCode['600'][1])->toBe('\'=HYPERLINK("http://evil")')
        ->and($byCode['600'][11])->toBe('3000.0000')
        ->and($byCode['100'][10])->toBe('10000.0000')
        ->and(end($rows))->toBe(['Total', '', '', '', '0.0000', '0.0000', '20600.0000', '20600.0000', '20600.0000', '20600.0000', '0.0000', '0.0000', '0.0000', '0.0000', '0.0000', '0.0000']);
});

it('exports the general ledger and the statement with opening, running balance and totals', function (): void {
    $account = Books::account($this->company, '600')->id;
    $rows = csvRows(($this->get)("general-ledger/export?account_id={$account}&date_from=2027-01-01&date_to=2027-12-31")->assertOk());

    expect($rows)->toHaveCount(4)
        ->and($rows[1][5])->toBe('Opening balance')
        ->and($rows[2][0])->toBe('2027-02-20')
        // Negative numbers are plain numbers, never prefixed by the formula guard.
        ->and($rows[2][10])->toBe('-3000.0000')
        ->and($rows[3])->toBe(['', '', '', '', '', 'Total', '', '', '0.0000', '3000.0000', '-3000.0000']);

    $party = Books::$parties[1];
    $statement = csvRows(($this->get)("account-statement/export?party_id={$party}&date_from=2027-01-01&date_to=2027-12-31")->assertOk());
    expect(array_column(array_slice($statement, 2, 2), 10))->toBe(['3600.0000', '0.0000']);
});

it('exports the journal book with devreden first and the carried total last', function (): void {
    $rows = csvRows(($this->get)('journal-book/export?date_from=2027-03-01&date_to=2027-03-31')->assertOk());

    expect($rows[1])->toBe(['', '', '', '', 'Brought forward', '', '', '', '', '16500.0000', '16500.0000'])
        ->and(array_column(array_slice($rows, 2, 4), 0))->toBe(['2027000000004', '2027000000004', '2027000000006', '2027000000006'])
        ->and(end($rows))->toBe(['', '', '', '', 'Total', '', '', '', '', '20600.0000', '20600.0000']);
});

it('exports XLSX on request', function (): void {
    $response = ($this->get)('journal-book/export?period_id='.Books::period($this->company, '2027', 2)->id.'&format=xlsx')->assertOk();

    expect($response->headers->get('Content-Type'))->toContain('spreadsheetml')
        ->and((string) $response->headers->get('Content-Disposition'))->toContain('.xlsx');
});

it('refuses an export above the row cap with a validation error', function (): void {
    config(['accounting.export_max_rows' => 3]);
    $account = Books::account($this->company, '100')->id;

    // February: one line plus opening and total rows fits; the year (three lines) and the journal do not.
    ($this->get)("general-ledger/export?account_id={$account}&period_id=".Books::period($this->company, '2027', 2)->id)->assertOk();
    ($this->get)("general-ledger/export?account_id={$account}&date_from=2027-01-01&date_to=2027-12-31")->assertStatus(422);
    $response = ($this->get)('journal-book/export?date_from=2027-01-01&date_to=2027-12-31')->assertStatus(422);
    expect($response->json('errors.code'))->toBe('VALIDATION_ERROR')
        ->and($response->json('errors.fields.filter.0'))->toContain('3');

    config(['accounting.export_max_rows' => 50000]);
    expect(ReportExporter::maxRows())->toBe(50000);
    ($this->get)('journal-book/export?date_from=2027-01-01&date_to=2027-12-31')->assertOk();
});

it('guards every text cell that a spreadsheet would run', function (string $value, string $expected): void {
    expect(ReportExporter::cell($value))->toBe($expected);
})->with([
    ['=1+1', "'=1+1"],
    ['+cmd', "'+cmd"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['-x', "'-x"],
    ["\tx", "'\tx"],
    ['-12.5000', '-12.5000'],
    ['Kasa', 'Kasa'],
]);
