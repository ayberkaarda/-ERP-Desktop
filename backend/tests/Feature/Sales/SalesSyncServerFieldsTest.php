<?php

declare(strict_types=1);

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Identity;
use Tests\Support\Sales\SalesKit;
use Tests\Support\Sync;

/*
 * `number` is assigned by the server. A push that carries it is refused like `status`
 * (rejected SYNC_OFFLINE_WRITE_NOT_ALLOWED, as the stock-documents writer already does), not
 * applied with the field silently dropped. Nothing is written and no version is spent.
 */
uses(RefreshDatabase::class);

/** @return array<string, string> */
function serverFieldsHeaders(User $user, string $company): array
{
    return [...Sync::deviceHeaders($user, null, 'fp-sales-server-fields-01'), 'X-Company-Id' => $company];
}

/**
 * @param  array<string, string>  $headers
 * @param  array<string, mixed>  $payload
 * @return array<string, mixed>
 */
function serverFieldsPush(array $headers, string $resource, string $op, string $id, array $payload, ?int $base): array
{
    Identity::fresh();
    test()->flushHeaders();

    return test()->withHeaders($headers)->postJson('/api/v1/sync/push', ['schema_version' => 1, 'mutations' => [[
        'idempotency_key' => (string) Str::uuid7(), 'op' => $op, 'resource' => $resource, 'id' => $id,
        'base_version' => $base, 'changed_fields' => $op === 'update' ? array_keys($payload) : [],
        'occurred_at' => '2027-06-14T10:00:00+03:00', 'payload' => $payload,
    ]]])->assertOk()->json('data.results.0');
}

/** @return array<string, mixed> */
function serverFieldsBody(object $w, string $notes): array
{
    return ['party_id' => $w->party->id, 'document_date' => '2027-06-10', 'notes' => $notes, 'lines' => [['item_id' => $w->item->id, 'quantity' => '2', 'unit_price' => '120']]];
}

it('refuses a push update that carries the number of a draft quote or order', function (string $resource, string $table): void {
    $w = SalesKit::world(stock: false);
    $headers = serverFieldsHeaders($w->user, $w->company);
    $draft = SalesKit::post($w->user, $w->company, $resource, serverFieldsBody($w, 'Draft'))->assertCreated()->json('data');

    $result = serverFieldsPush($headers, $resource, 'update', $draft['id'], ['notes' => 'offline', 'number' => 'HACK-0001'], (int) $draft['version']);

    expect($result['status'])->toBe('rejected')
        ->and($result['error']['code'])->toBe('SYNC_OFFLINE_WRITE_NOT_ALLOWED')
        ->and((array) DB::table($table)->where('id', $draft['id'])->first(['number', 'notes', 'version']))
        ->toBe(['number' => null, 'notes' => 'Draft', 'version' => (int) $draft['version']]);
})->with([
    'quote' => ['sales-quotes', 'sales_quotes'],
    'order' => ['sales-orders', 'sales_orders'],
]);

it('refuses a push create that brings its own number', function (): void {
    $w = SalesKit::world(stock: false);
    $headers = serverFieldsHeaders($w->user, $w->company);
    $id = (string) Str::uuid7();

    $result = serverFieldsPush($headers, 'sales-quotes', 'create', $id, [...serverFieldsBody($w, 'Offline'), 'number' => 'TKL-2027-000001'], null);

    expect($result['status'])->toBe('rejected')
        ->and($result['error']['code'])->toBe('SYNC_OFFLINE_WRITE_NOT_ALLOWED')
        ->and(DB::table('sales_quotes')->where('id', $id)->exists())->toBeFalse();
});
