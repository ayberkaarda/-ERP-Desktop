<?php

declare(strict_types=1);

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\Support\Companies;

/*
 * A second connection plays the retry that takes over an expired lease while the original
 * request is still running. Committed data, so no RefreshDatabase; own rows are deleted.
 */
beforeEach(function (): void {
    if (! Schema::hasTable('idempotency_keys')) {
        Artisan::call('migrate', ['--force' => true]);
    }

    config(['database.connections.pgsql_retry' => config('database.connections.pgsql')]);
    $this->key = 'fence-'.Str::uuid7();
    $this->company = Companies::make();

    Route::post('/api/v1/_probe/slow', function () {
        DB::table('number_sequences')->insert([
            'company_id' => $this->company, 'doc_type' => 'original', 'fiscal_year' => 2026, 'last_value' => 1,
        ]);

        // Meanwhile the lease ran out and a retry replaced the claim and finished.
        $retry = DB::connection('pgsql_retry');
        $old = $retry->table('idempotency_keys')->where('key', $this->key)->first();
        $retry->table('idempotency_keys')->where('key', $this->key)->delete();
        $retry->table('idempotency_keys')->insert(array_merge((array) $old, [
            'id' => (string) Str::uuid7(),
            'status' => 'completed',
            'response_status' => 201,
            'response_body' => '{"data":"retry"}',
            'lease_expires_at' => null,
            'expires_at' => Carbon::now()->addDay(),
        ]));

        return new JsonResponse(['data' => 'original'], 201);
    })->middleware('api', 'idempotent');
});

afterEach(function (): void {
    DB::table('idempotency_keys')->where('key', $this->key)->delete();
    DB::table('number_sequences')->where('company_id', $this->company)->delete();
    Companies::remove($this->company);
    DB::purge('pgsql_retry');
});

it('fences a late original by claim id so it cannot overwrite the replacement', function (): void {
    $this->postJson('/api/v1/_probe/slow', [], ['Idempotency-Key' => $this->key])
        ->assertStatus(409)
        ->assertJsonPath('errors.code', 'IDEMPOTENCY_IN_PROGRESS');

    $row = DB::table('idempotency_keys')->where('key', $this->key)->first();

    expect($row?->status)->toBe('completed')
        ->and($row?->response_body)->toBe('{"data":"retry"}')
        ->and(DB::table('number_sequences')->where('company_id', $this->company)->count())->toBe(0);

    $this->postJson('/api/v1/_probe/slow', [], ['Idempotency-Key' => $this->key])
        ->assertStatus(201)
        ->assertExactJson(['data' => 'retry']);
});
