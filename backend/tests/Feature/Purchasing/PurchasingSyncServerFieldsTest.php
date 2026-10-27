<?php

declare(strict_types=1);

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Identity;
use Tests\Support\Purchasing\PurchKit;
use Tests\Support\Sync;

/*
 * `number` of a purchase request is assigned by the server: a push that carries it is refused
 * (rejected SYNC_OFFLINE_WRITE_NOT_ALLOWED), not applied with the field dropped.
 */
uses(RefreshDatabase::class);

it('refuses a push update or create of a purchase request that carries a number', function (): void {
    $w = PurchKit::world();
    $headers = [...Sync::deviceHeaders($w->user, null, 'fp-purch-server-fields-01'), 'X-Company-Id' => $w->company];
    $body = ['needed_by' => '2027-07-01', 'notes' => 'Original', 'lines' => [['item_id' => $w->item->id, 'quantity' => '10', 'estimated_price' => '50']]];
    $draft = PurchKit::post($w->user, $w->company, 'purchase-requests', $body)->assertCreated()->json('data');
    $push = function (string $op, string $id, array $payload, ?int $base) use ($headers): array {
        Identity::fresh();
        test()->flushHeaders();

        return test()->withHeaders($headers)->postJson('/api/v1/sync/push', ['schema_version' => 1, 'mutations' => [[
            'idempotency_key' => (string) Str::uuid7(), 'op' => $op, 'resource' => 'purchase-requests', 'id' => $id,
            'base_version' => $base, 'changed_fields' => $op === 'update' ? array_keys($payload) : [],
            'occurred_at' => '2027-06-14T10:00:00+03:00', 'payload' => $payload,
        ]]])->assertOk()->json('data.results.0');
    };

    $update = $push('update', $draft['id'], ['notes' => 'offline', 'number' => 'HACK-0001'], (int) $draft['version']);
    $newId = (string) Str::uuid7();
    $create = $push('create', $newId, [...$body, 'number' => $draft['number'] ?? 'HACK-0002'], null);

    expect([$update['status'], $update['error']['code'] ?? null])->toBe(['rejected', 'SYNC_OFFLINE_WRITE_NOT_ALLOWED'])
        ->and([$create['status'], $create['error']['code'] ?? null])->toBe(['rejected', 'SYNC_OFFLINE_WRITE_NOT_ALLOWED'])
        ->and((array) DB::table('purchase_requests')->where('id', $draft['id'])->first(['notes', 'version']))
        ->toBe(['notes' => 'Original', 'version' => (int) $draft['version']])
        ->and(DB::table('purchase_requests')->where('id', $newId)->exists())->toBeFalse();
});
