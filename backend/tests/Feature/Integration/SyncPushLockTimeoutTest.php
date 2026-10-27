<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Feature\Sync\Support\SyncKit;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Identity;
use Tests\Support\Sales\SalesKit;

/*
 * Push locks its target row with a bounded wait: the mutation sets its own lock_timeout, so a
 * row held by another transaction answers 409 IDEMPOTENCY_IN_PROGRESS with Retry-After instead
 * of waiting for as long as the holder keeps the lock. The session here sets no lock_timeout;
 * a statement_timeout only keeps a regression from hanging the run.
 */
uses(SyncDatabase::class);

beforeEach(function (): void {
    $this->w = SalesKit::world();
    config(['database.connections.push_lock_holder' => config('database.connections.'.config('database.default'))]);
});

afterEach(function (): void {
    DB::statement('SET statement_timeout = 0');
    DB::disconnect('push_lock_holder');
});

/** @return array<string, string> */
function pushLockHeaders(object $test): array
{
    Identity::fresh();
    $token = (string) $test->postJson('/api/v1/auth/device', [
        'email' => $test->w->user->email, 'password' => Identity::PASSWORD,
        'device_name' => 'Kasa PC', 'fingerprint' => 'fp-push-lock-timeout-01',
    ])->assertOk()->json('data.token');

    return ['Accept' => 'application/json', 'Authorization' => 'Bearer '.$token, 'X-Company-Id' => $test->w->company];
}

/** @return array<string, mixed> */
function pushLockDraftOrder(object $test): array
{
    return SalesKit::post($test->w->user, $test->w->company, 'sales-orders', [
        'party_id' => $test->w->party->id, 'document_date' => '2027-06-10', 'notes' => 'x',
        'lines' => [['item_id' => $test->w->service->id, 'quantity' => '1', 'unit_price' => '100']],
    ])->assertCreated()->json('data');
}

/** @return array<string, mixed> */
function pushLockUpdate(string $id, int $base): array
{
    return [
        'idempotency_key' => (string) Str::uuid7(), 'op' => 'update', 'resource' => 'sales-orders', 'id' => $id,
        'base_version' => $base, 'changed_fields' => ['notes'], 'occurred_at' => '2027-06-14T10:00:00+03:00',
        'payload' => ['notes' => 'offline'],
    ];
}

it('takes the push row lock under a bounded lock_timeout', function (): void {
    $order = pushLockDraftOrder($this);
    $headers = pushLockHeaders($this);
    $seen = null;
    DB::listen(function ($query) use (&$seen): void {
        if ($seen === null && str_contains(strtolower($query->sql), 'for update')) {
            $seen = 'pending';
            $seen = (string) DB::selectOne('show lock_timeout')->lock_timeout;
        }
    });

    SyncKit::push($this, [pushLockUpdate($order['id'], (int) $order['version'])], $headers)->assertOk();

    expect($seen)->not->toBeNull()->not->toBe('0');
});

it('answers a push on a row held by another transaction with 409 IDEMPOTENCY_IN_PROGRESS', function (): void {
    $order = pushLockDraftOrder($this);
    $headers = pushLockHeaders($this);
    $mutation = pushLockUpdate($order['id'], (int) $order['version']);
    $holder = DB::connection('push_lock_holder');
    $holder->beginTransaction();
    $holder->select('SELECT id FROM sales_orders WHERE id = ? FOR UPDATE', [$order['id']]);
    DB::statement("SET statement_timeout = '8s'");
    $started = microtime(true);

    try {
        $busy = SyncKit::push($this, [$mutation], $headers);
    } finally {
        DB::statement('SET statement_timeout = 0');
        $holder->rollBack();
    }

    $busy->assertStatus(409)->assertHeader('Retry-After');
    expect(SyncKit::wire($busy, 'sync/error.response.schema.json')['errors']['code'])->toBe('IDEMPOTENCY_IN_PROGRESS')
        ->and(microtime(true) - $started)->toBeLessThan(8.0)
        ->and(DB::table('sales_orders')->where('id', $order['id'])->value('notes'))->toBe('x');

    $retry = SyncKit::wire(SyncKit::push($this, [$mutation], $headers)->assertOk(), 'sync/push.response.schema.json')['data']['results'];
    expect($retry[0]['status'])->toBe('applied');
});
