<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Companies;

/*
 * A row lock that is not available (SQLSTATE 55P03: NOWAIT refused, or lock_timeout reached)
 * means "another transaction is changing this record": REST answers 409 VERSION_CONFLICT with
 * Retry-After, like InvoiceService does for a moved source, instead of 500 SERVER_ERROR.
 * Committing database: the holder runs on its own connection.
 */
uses(SyncDatabase::class);

beforeEach(function (): void {
    $this->company = Companies::make();
    config(['database.connections.lock_holder' => config('database.connections.'.config('database.default'))]);
    Route::middleware('api')->get('/api/v1/__lock-probe', fn () => DB::select('select id from companies where id = ? for update nowait', [$this->company]));
    Route::middleware('api')->get('/api/v1/__other-db-error', fn () => DB::select('select 1/0'));
});

afterEach(function (): void {
    DB::disconnect('lock_holder');
});

it('answers a busy row lock with 409 VERSION_CONFLICT', function (): void {
    $holder = DB::connection('lock_holder');
    $holder->beginTransaction();
    $holder->select('select id from companies where id = ? for update', [$this->company]);

    try {
        $response = $this->getJson('/api/v1/__lock-probe');
    } finally {
        $holder->rollBack();
    }

    $response->assertStatus(409)->assertHeader('Retry-After', '1')->assertJsonPath('errors.code', 'VERSION_CONFLICT');
    $this->getJson('/api/v1/__lock-probe')->assertOk();
});

it('keeps other database errors at 500 SERVER_ERROR', function (): void {
    $this->getJson('/api/v1/__other-db-error')->assertStatus(500)->assertJsonPath('errors.code', 'SERVER_ERROR');
});
