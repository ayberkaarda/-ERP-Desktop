<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Feature\Sync\Support\SyncKit;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Identity;
use Tests\Support\Sales\SalesKit;

/*
 * Abuse group A / 4: busy row locks (SQLSTATE 55P03) on the real endpoints. REST must answer
 * 409 VERSION_CONFLICT with Retry-After, push 409 IDEMPOTENCY_IN_PROGRESS with Retry-After, and a
 * retry with the same keys must replay what already committed and apply the rest exactly once,
 * with no duplicate side effect. Real REST sales endpoints and real sales-orders push writer
 * (shipped offline manifest). A second connection holds the row lock. Safe behaviour asserted.
 */
uses(SyncDatabase::class);

beforeEach(function (): void {
    $this->w = SalesKit::world();
    $this->fingerprint = 'fp-abuse-a-lock-0001';
    config(['database.connections.abuse_a_lock' => config('database.connections.'.config('database.default'))]);
});

afterEach(function (): void {
    DB::statement('SET lock_timeout = 0');
    DB::disconnect('abuse_a_lock');
});

/** @return array<string, string> */
function abuseALockDevice(object $test): array
{
    Identity::fresh();
    $token = (string) $test->postJson('/api/v1/auth/device', [
        'email' => $test->w->user->email, 'password' => Identity::PASSWORD,
        'device_name' => 'Kasa PC', 'fingerprint' => $test->fingerprint,
    ])->assertOk()->json('data.token');

    return ['Accept' => 'application/json', 'Authorization' => 'Bearer '.$token, 'X-Company-Id' => $test->w->company];
}

/** @return array<string, mixed> */
function abuseADraftOrder(object $test, string $notes): array
{
    return SalesKit::post($test->w->user, $test->w->company, 'sales-orders', [
        'party_id' => $test->w->party->id, 'document_date' => '2027-06-10', 'notes' => $notes,
        'lines' => [['item_id' => $test->w->service->id, 'quantity' => '1', 'unit_price' => '100']],
    ])->assertCreated()->json('data');
}

/**
 * @param  array<string, mixed>  $payload
 * @return array<string, mixed>
 */
function abuseAOrderMutation(string $op, string $id, array $payload, ?int $base): array
{
    return [
        'idempotency_key' => (string) Str::uuid7(),
        'op' => $op,
        'resource' => 'sales-orders',
        'id' => $id,
        'base_version' => $op === 'create' ? null : $base,
        'changed_fields' => $op === 'update' ? array_keys($payload) : [],
        'occurred_at' => '2027-06-14T10:00:00+03:00',
        'payload' => $payload,
    ];
}

/** Holds a FOR UPDATE on the order on the second connection until $fn returns. */
function abuseAHolding(string $orderId, Closure $fn): mixed
{
    $holder = DB::connection('abuse_a_lock');
    $holder->beginTransaction();
    $holder->select('SELECT id FROM sales_orders WHERE id = ? FOR UPDATE', [$orderId]);
    DB::statement("SET lock_timeout = '300ms'");

    try {
        return $fn();
    } finally {
        DB::statement('SET lock_timeout = 0');
        $holder->rollBack();
    }
}

it('ABA-LOCK-01 answers a REST cancel of a busy order with 409 VERSION_CONFLICT and cancels once on retry', function (): void {
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->service->id, '1', '100']]);
    $key = (string) Str::uuid7();

    $busy = abuseAHolding($order['id'], fn () => SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/cancel", [], $key));

    $busy->assertStatus(409)->assertHeader('Retry-After', '1')->assertJsonPath('errors.code', 'VERSION_CONFLICT');
    expect(DB::table('sales_orders')->where('id', $order['id'])->value('status'))->toBe('confirmed');

    $done = SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/cancel", [], $key)->assertOk();
    $replay = SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/cancel", [], $key)->assertOk();

    expect($done->json('data.status'))->toBe('cancelled')
        ->and($replay->headers->get('Idempotent-Replayed'))->not->toBeNull()
        ->and($replay->json('data.version'))->toBe($done->json('data.version'))
        ->and(DB::table('activity_log')->where('subject_id', $order['id'])->where('attribute_changes', 'like', '%cancelled%')->count())->toBeLessThanOrEqual(1);
});

it('ABA-LOCK-02 answers a push meeting a busy order with 409 IDEMPOTENCY_IN_PROGRESS and replays the committed part on retry', function (): void {
    $free = abuseADraftOrder($this, 'free');
    $held = abuseADraftOrder($this, 'held');
    $newId = (string) Str::uuid7();
    $batch = [
        abuseAOrderMutation('update', $free['id'], ['notes' => 'offline free'], (int) $free['version']),
        abuseAOrderMutation('create', $newId, [
            'party_id' => $this->w->party->id, 'document_date' => '2027-06-10',
            'lines' => [['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '100']],
        ], null),
        abuseAOrderMutation('update', $held['id'], ['notes' => 'offline held'], (int) $held['version']),
    ];
    $headers = abuseALockDevice($this);
    $ordersBefore = DB::table('sales_orders')->where('company_id', $this->w->company)->count();

    $busy = abuseAHolding($held['id'], fn () => SyncKit::push($this, $batch, $headers));

    $busy->assertStatus(409)->assertHeader('Retry-After', '1');
    expect(SyncKit::wire($busy, 'sync/error.response.schema.json')['errors']['code'])->toBe('IDEMPOTENCY_IN_PROGRESS')
        ->and(DB::table('sales_orders')->where('id', $free['id'])->value('notes'))->toBe('offline free')
        ->and(DB::table('sales_orders')->where('id', $newId)->count())->toBe(1)
        ->and(DB::table('sales_orders')->where('id', $held['id'])->value('notes'))->toBe('held');
    $freeVersion = (int) DB::table('sales_orders')->where('id', $free['id'])->value('version');

    // Retry with the same keys, twice: the committed part replays, the rest applies exactly once.
    $retry = SyncKit::wire(SyncKit::push($this, $batch, $headers)->assertOk(), 'sync/push.response.schema.json')['data']['results'];
    $again = SyncKit::wire(SyncKit::push($this, $batch, $headers)->assertOk(), 'sync/push.response.schema.json')['data']['results'];

    expect(array_column($retry, 'status'))->toBe(['duplicate', 'duplicate', 'applied'])
        ->and(array_column($again, 'status'))->toBe(['duplicate', 'duplicate', 'duplicate'])
        ->and((int) DB::table('sales_orders')->where('id', $free['id'])->value('version'))->toBe($freeVersion)
        ->and(DB::table('sales_orders')->where('company_id', $this->w->company)->count())->toBe($ordersBefore + 1)
        ->and(DB::table('sales_order_lines')->where('document_id', $newId)->count())->toBe(1)
        ->and(DB::table('sales_orders')->where('id', $held['id'])->value('notes'))->toBe('offline held');
});

it('ABA-LOCK-03 bounds how long a push waits on a busy row (lock_timeout set for the mutation)', function (): void {
    $order = abuseADraftOrder($this, 'x');
    $headers = abuseALockDevice($this);
    $seen = null;
    DB::listen(function ($query) use (&$seen): void {
        if ($seen === null && str_contains(strtolower($query->sql), 'for update')) {
            $seen = 'pending';
            $seen = (string) DB::selectOne('show lock_timeout')->lock_timeout;
        }
    });

    SyncKit::push($this, [abuseAOrderMutation('update', $order['id'], ['notes' => 'y'], (int) $order['version'])], $headers)->assertOk();

    // Safe: the push's row lock waits a bounded time (so 55P03 -> IDEMPOTENCY_IN_PROGRESS can
    // happen); '0' means it waits for as long as the holder keeps the lock.
    expect($seen)->not->toBeNull()->not->toBe('0');
});
