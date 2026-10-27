<?php

declare(strict_types=1);

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Identity;
use Tests\Support\Sales\SalesKit;

/*
 * A replayed VERSION_CONFLICT is rebuilt against the row as it is now: server_version,
 * server_data and conflicting_fields together. A web change made after the first answer is
 * therefore named in the replay, and a merge the client builds from it at that server_version
 * does not overwrite the change. Real sales-quotes writer, shipped manifest, device token.
 */
uses(SyncDatabase::class);

beforeEach(function (): void {
    $this->w = SalesKit::world(stock: false);
    $this->w->user = SalesKit::user(['parties.view', 'parties.create']);
});

function replayToken(User $user): string
{
    Identity::fresh();
    test()->flushHeaders();

    return (string) test()->postJson('/api/v1/auth/device', [
        'email' => $user->email, 'password' => Identity::PASSWORD, 'device_name' => 'Replay PC', 'fingerprint' => 'fp-conflict-replay-01',
    ])->assertOk()->json('data.token');
}

/**
 * @param  list<array<string, mixed>>  $mutations
 * @return list<array<string, mixed>>
 */
function replayPush(string $token, string $company, array $mutations): array
{
    Identity::fresh();
    test()->flushHeaders();

    return test()->withHeaders(['Accept' => 'application/json', 'Authorization' => 'Bearer '.$token, 'X-Company-Id' => $company])
        ->postJson('/api/v1/sync/push', ['schema_version' => 1, 'mutations' => $mutations])->assertOk()->json('data.results');
}

/**
 * @param  array<string, mixed>  $payload
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function replayUpdate(string $id, array $payload, int $base, array $overrides = []): array
{
    return [
        'idempotency_key' => (string) Str::uuid7(), 'op' => 'update', 'resource' => 'sales-quotes', 'id' => $id,
        'base_version' => $base, 'changed_fields' => array_keys($payload), 'occurred_at' => '2027-06-14T10:00:00+03:00',
        'payload' => $payload, ...$overrides,
    ];
}

/**
 * Quote at v1; the web changes notes (v2); the desktop pushes notes + document_date on v1
 * (conflict on notes); the web then changes document_date (v3).
 *
 * @return array{id: string, token: string, edit: array<string, mixed>, first: array<string, mixed>}
 */
function replayScenario(object $test): array
{
    $w = $test->w;
    $id = (string) SalesKit::post($w->user, $w->company, 'sales-quotes', [
        'party_id' => $w->party->id, 'document_date' => '2027-06-10', 'notes' => 'Q1',
        'lines' => [['item_id' => $w->item->id, 'quantity' => '1', 'unit_price' => '10']],
    ])->assertCreated()->json('data.id');
    $token = replayToken($w->user);

    $v2 = SalesKit::patch($w->user, $w->company, "sales-quotes/{$id}", ['version' => 1, 'notes' => 'web notes'])->assertOk()->json('data');
    $edit = replayUpdate($id, ['notes' => 'desk notes', 'document_date' => '2027-06-09'], 1);
    $first = replayPush($token, $w->company, [$edit])[0];
    SalesKit::patch($w->user, $w->company, "sales-quotes/{$id}", ['version' => $v2['version'], 'document_date' => '2027-06-12'])->assertOk();

    return ['id' => $id, 'token' => $token, 'edit' => $edit, 'first' => $first];
}

it('recomputes conflicting_fields with server_version and server_data when a VERSION_CONFLICT is replayed', function (): void {
    ['token' => $token, 'edit' => $edit, 'first' => $first] = replayScenario($this);

    expect($first['conflict'])->toMatchArray(['code' => 'VERSION_CONFLICT', 'server_version' => 2])
        ->and($first['conflict']['conflicting_fields'])->toContain('notes')->not->toContain('document_date');

    $replay = replayPush($token, $this->w->company, [$edit])[0];

    expect($replay)->toMatchArray(['status' => 'conflict', 'replayed' => true])
        ->and($replay['conflict'])->toMatchArray(['code' => 'VERSION_CONFLICT', 'base_version' => 1, 'server_version' => 3])
        ->and($replay['conflict']['server_data']['version'])->toBe(3)
        ->and(substr((string) $replay['conflict']['server_data']['document_date'], 0, 10))->toBe('2027-06-12')
        ->and($replay['conflict']['conflicting_fields'])->toContain('notes')->toContain('document_date');
});

it('does not let a merge built from the replayed conflict overwrite the web change made after the first answer', function (): void {
    ['id' => $id, 'token' => $token, 'edit' => $edit] = replayScenario($this);
    $replay = replayPush($token, $this->w->company, [$edit])[0]['conflict'];

    // The client takes the server's value for every conflicting field and keeps its own for the
    // rest, at the server_version it was given.
    $merge = [];

    foreach (['notes' => 'desk notes', 'document_date' => '2027-06-09'] as $field => $mine) {
        $merge[$field] = in_array($field, $replay['conflicting_fields'], true) ? $replay['server_data'][$field] : $mine;
    }

    $result = replayPush($token, $this->w->company, [replayUpdate($id, $merge, (int) $replay['server_version'], [
        'resolution' => ['resolves' => $edit['idempotency_key'], 'code' => 'VERSION_CONFLICT', 'choice' => 'merge'],
    ])])[0];

    $stored = (string) DB::table('sales_quotes')->where('id', $id)->value('document_date');
    expect(substr($stored, 0, 10))->toBe('2027-06-12', "merge outcome: {$result['status']}");
});
