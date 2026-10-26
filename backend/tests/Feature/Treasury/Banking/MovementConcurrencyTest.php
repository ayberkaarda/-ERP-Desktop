<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Modules\Treasury\Banking\Services\Statements;
use App\Modules\Treasury\Services\PaymentService;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\ValidationException;
use Tests\Feature\Treasury\Banking\ExtensionKit;

beforeEach(function (): void {
    if (! Schema::hasTable('treasury_bank_statements')) {
        Artisan::call('migrate', ['--force' => true]);
    }
    $this->currencies = DB::table('currencies')->pluck('code')->all();
    $this->w = ExtensionKit::world();
    $this->bank = ExtensionKit::bank($this->w);
    $this->payment = ExtensionKit::receipt($this->w, $this->bank);
    $this->statement = ExtensionKit::statement($this->w, $this->bank);
    app(CompanyContext::class)->set($this->w->company);
    config(['database.connections.treasury_second' => config('database.connections.pgsql')]);
    $this->first = DB::connection('pgsql');
    $this->second = DB::connection('treasury_second');
});

afterEach(function (): void {
    DB::setDefaultConnection('pgsql');
    foreach ([$this->first, $this->second] as $connection) {
        while ($connection->transactionLevel() > 0) {
            $connection->rollBack();
        }
    }
    $tables = DB::table('information_schema.columns')->where('table_schema', 'public')->where('column_name', 'company_id')->pluck('table_name');
    DB::statement('SET session_replication_role = replica');
    try {
        foreach ($tables as $table) {
            DB::table((string) $table)->where('company_id', $this->w->company)->delete();
        }
        DB::table('users')->where('id', $this->w->user->id)->delete();
        DB::table('companies')->where('id', $this->w->company)->delete();
        DB::table('currencies')->whereNotIn('code', $this->currencies)->delete();
    } finally {
        DB::statement('SET session_replication_role = DEFAULT');
    }
    DB::purge('treasury_second');
    app(CompanyContext::class)->clear();
});

function secondTreasuryConnection(Closure $action): mixed
{
    DB::setDefaultConnection('treasury_second');
    DB::connection()->statement("SET lock_timeout = '300ms'");
    try {
        return $action();
    } finally {
        DB::setDefaultConnection('pgsql');
    }
}

it('serializes statement matching against a concurrent payment reversal', function (): void {
    $this->first->beginTransaction();
    app(Statements::class)->match($this->statement['id'], 1, $this->statement['lines'][0]['id'], $this->payment['id']);
    $blocked = null;
    try {
        secondTreasuryConnection(fn () => app(PaymentService::class)->reverse($this->payment['id'], $this->payment['version'], '2027-06-16', 'Concurrent reversal'));
    } catch (QueryException $exception) {
        $blocked = $exception;
    }
    expect($blocked?->errorInfo[0])->toBe('55P03');
    $this->first->commit();
    expect(fn () => secondTreasuryConnection(fn () => app(PaymentService::class)->reverse($this->payment['id'], $this->payment['version'], '2027-06-16', 'Concurrent reversal')))->toThrow(ValidationException::class);
    expect(DB::table('treasury_payments')->where('id', $this->payment['id'])->value('status'))->toBe('posted');
});

it('cannot finish a match against a movement reversed by another transaction', function (): void {
    $this->first->beginTransaction();
    app(PaymentService::class)->reverse($this->payment['id'], $this->payment['version'], '2027-06-16', 'Concurrent reversal');
    $movement = DB::table('treasury_movements')->where('source_type', 'treasury_payment')->where('source_id', $this->payment['id'])->first();
    $blocked = null;
    try {
        secondTreasuryConnection(fn () => app(Statements::class)->match($this->statement['id'], 1, $this->statement['lines'][0]['id'], null, $movement->id));
    } catch (QueryException $exception) {
        $blocked = $exception;
    }
    expect($blocked?->errorInfo[0])->toBe('55P03');
    $this->first->commit();
    expect(fn () => secondTreasuryConnection(fn () => app(Statements::class)->match($this->statement['id'], 1, $this->statement['lines'][0]['id'], null, $movement->id)))->toThrow(ValidationException::class);
    expect(DB::table('treasury_bank_statement_lines')->where('id', $this->statement['lines'][0]['id'])->value('movement_id'))->toBeNull();
});
