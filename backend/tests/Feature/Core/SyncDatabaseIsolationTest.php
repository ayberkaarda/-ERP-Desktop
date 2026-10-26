<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Companies;

/*
 * Two tests in a row: the first commits changes to a seeded table and rows that depend on
 * them; the second must start from the seeded state again, with no orphans left.
 *
 * Migrations seed no rows today, so the first test plants a seed row and retakes the seed
 * copy; the second test removes it again so later tests see the real seed state.
 */
uses(SyncDatabase::class);

$state = new ArrayObject;

function currencyRows(): string
{
    return json_encode(DB::table('currencies')->orderBy('code')->get()->all(), JSON_THROW_ON_ERROR);
}

it('commits changes to seeded and dependent tables', function () use ($state): void {
    DB::table('currencies')->insert([
        ['id' => (string) Str::uuid7(), 'code' => 'XTS', 'name' => 'Seed one', 'symbol' => 'S'],
        ['id' => (string) Str::uuid7(), 'code' => 'XXX', 'name' => 'Seed two', 'symbol' => 'X'],
    ]);
    $this->retakeSeedSnapshot();
    $state['currencies'] = currencyRows();

    DB::table('currencies')->insert(['id' => (string) Str::uuid7(), 'code' => 'XBA', 'name' => 'Added', 'symbol' => 'A']);
    DB::table('currencies')->where('code', 'XTS')->update(['name' => 'Changed by a test']);
    DB::table('currencies')->where('code', 'XXX')->delete();
    $company = Companies::make();
    DB::table('company_currencies')->insert(['company_id' => $company, 'currency_code' => 'XBA']);

    expect(DB::transactionLevel())->toBe(0)
        ->and(DB::table('company_currencies')->where('currency_code', 'XBA')->exists())->toBeTrue();
});

it('starts the next test from the seeded state without orphans', function () use ($state): void {
    try {
        expect($state['currencies'] ?? null)->toBeString()
            ->and(currencyRows())->toBe($state['currencies'])
            ->and(DB::table('company_currencies')->count())->toBe(0)
            ->and(DB::table('companies')->count())->toBe(0);
    } finally {
        DB::table('currencies')->whereIn('code', ['XTS', 'XXX'])->delete();
        $this->retakeSeedSnapshot();
    }
});
