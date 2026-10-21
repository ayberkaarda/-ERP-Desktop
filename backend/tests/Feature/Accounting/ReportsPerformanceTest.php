<?php

declare(strict_types=1);

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Arr;
use Illuminate\Testing\TestResponse;
use Tests\Support\Accounting\Books;
use Tests\Support\Actors;

uses(RefreshDatabase::class);

/**
 * Sanity check on a few thousand lines: 6 entries of 500 lines (250 x 100 Kasa 1.25 D, 250 x 600
 * 1.25 C) in January to June, so 3000 lines and 1875.00 per side.
 */
beforeEach(function (): void {
    Books::boot();
    $this->company = Books::company();

    foreach (range(1, 6) as $month) {
        $lines = [];

        foreach (range(1, 250) as $i) {
            $lines[] = ['100', '1.25', '0'];
            $lines[] = ['600', '0', '1.25'];
        }

        Books::post($this->company, sprintf('2027-%02d-15', $month), $lines);
    }

    $this->user = Actors::user(['accounting.reports.view'], $this->company);
    $this->get = fn (string $uri): TestResponse => Books::as($this->user, $this->company)->getJson('/api/v1/reports/'.$uri);
});

it('answers every report on 3000 lines quickly and identically from both sources', function (): void {
    $account = Books::account($this->company, '100')->id;
    $started = microtime(true);

    $aligned = ($this->get)('trial-balance?date_from=2027-01-01&date_to=2027-06-30')->assertOk()->json('data');
    $split = ($this->get)('trial-balance?date_from=2027-01-01&date_to=2027-06-29')->assertOk()->json('data');
    $ledger = ($this->get)("general-ledger?account_id={$account}&date_from=2027-02-01&date_to=2027-06-30&per_page=500&page=3")->assertOk()->json();
    $book = ($this->get)('journal-book?date_from=2027-01-01&date_to=2027-12-31&per_page=2&page=2')->assertOk()->json();
    $elapsed = microtime(true) - $started;

    expect($aligned['source'])->toBe('balances')
        ->and($split['source'])->toBe('lines')
        // Nothing is booked on 30 June, so both ranges hold the same bookings.
        ->and(Arr::except($split, ['source', 'date_to']))->toBe(Arr::except($aligned, ['source', 'date_to']))
        ->and($aligned['totals']['debit'])->toBe('1875.0000')
        ->and($aligned['balanced'])->toBeTrue()
        // February-June: 1250 lines of 100; page 3 of 500 starts after 1000 lines (opening January 312.50).
        ->and($ledger['meta']['pagination']['total'])->toBe(1250)
        ->and($ledger['meta']['opening_balance'])->toBe('312.5000')
        ->and($ledger['data'])->toHaveCount(250)
        ->and($ledger['data'][0]['running_balance'])->toBe('1563.7500')
        ->and(end($ledger['data'])['running_balance'])->toBe('1875.0000')
        ->and($ledger['meta']['closing_balance'])->toBe('1875.0000')
        ->and($book['meta']['page_brought_forward']['debit'])->toBe('625.0000')
        ->and($book['data'][0]['lines'])->toHaveCount(500)
        ->and($elapsed)->toBeLessThan(15.0);
});
