<?php

declare(strict_types=1);

use App\Core\Numbering\NumberSequenceService;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/*
 * Two real connections, committed data: the wrapping test transaction of
 * RefreshDatabase would hide rows from the second connection, so this file
 * migrates without wiping and deletes only its own rows.
 */
beforeEach(function (): void {
    if (! Schema::hasTable('number_sequences')) {
        Artisan::call('migrate', ['--force' => true]);
    }

    config(['database.connections.pgsql_second' => config('database.connections.pgsql')]);

    $this->company = (string) Str::uuid7();
    $this->a = DB::connection('pgsql');
    $this->b = DB::connection('pgsql_second');
    $this->numbersA = new NumberSequenceService($this->a);
    $this->numbersB = new NumberSequenceService($this->b);
});

afterEach(function (): void {
    if ($this->a->transactionLevel() > 0) {
        $this->a->rollBack();
    }

    $this->a->table('number_sequences')->where('company_id', $this->company)->delete();
    $this->b->statement('RESET lock_timeout');
    DB::purge('pgsql_second');
});

it('blocks a second connection while a number is held and stays gapless', function (): void {
    expect($this->numbersA->next($this->company, 'sales_invoice', 'ABC', 2026))->toBe('ABC2026000000001');

    $this->a->beginTransaction();
    expect($this->numbersA->next($this->company, 'sales_invoice', 'ABC', 2026))->toBe('ABC2026000000002');

    // Without the row lock B would read last_value=1 and also issue ...002.
    $this->b->statement("SET lock_timeout = '300ms'");
    expect(fn () => $this->numbersB->next($this->company, 'sales_invoice', 'ABC', 2026))
        ->toThrow(QueryException::class, 'lock timeout');

    // A gives the number back; B gets it, so no gap appears.
    $this->a->rollBack();
    expect($this->numbersB->next($this->company, 'sales_invoice', 'ABC', 2026))->toBe('ABC2026000000002');

    $this->a->beginTransaction();
    expect($this->numbersA->next($this->company, 'sales_invoice', 'ABC', 2026))->toBe('ABC2026000000003');
    $this->a->commit();

    expect($this->numbersB->next($this->company, 'sales_invoice', 'ABC', 2026))->toBe('ABC2026000000004');
});

it('lets two connections create the first row of a new sequence safely', function (): void {
    $this->a->beginTransaction();
    expect($this->numbersA->next($this->company, 'journal', null, 2026))->toBe('2026000000001');

    // B's insert of the same key waits on A's uncommitted row, then times out instead of duplicating.
    $this->b->statement("SET lock_timeout = '300ms'");
    expect(fn () => $this->numbersB->next($this->company, 'journal', null, 2026))->toThrow(QueryException::class);

    $this->a->commit();
    expect($this->numbersB->next($this->company, 'journal', null, 2026))->toBe('2026000000002');
});
