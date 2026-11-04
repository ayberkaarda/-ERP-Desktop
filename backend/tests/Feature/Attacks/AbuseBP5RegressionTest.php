<?php

declare(strict_types=1);

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Actors;
use Tests\Support\Identity;
use Tests\Support\Sales\SalesKit;
use Tests\Support\Sync;

/*
 * B4 — regression of the closed P5 findings after D1 (full-download session per device,
 * cursor/session, horizon floor, idempotency/resolutions), on real resources over HTTP.
 * Committed data (SyncDatabase).
 */
uses(SyncDatabase::class);

beforeEach(function (): void {
    $this->w = SalesKit::world(stock: false);
    $this->w->user = SalesKit::user(['parties.view', 'parties.create']);
});

/** @return array{token: string, refresh_token: string} */
function abP5Login(User $user, string $fingerprint = 'fp-abuse-b-p5-0001'): array
{
    Identity::fresh();
    test()->flushHeaders();
    $data = test()->postJson('/api/v1/auth/device', [
        'email' => $user->email, 'password' => Identity::PASSWORD, 'device_name' => 'P5 PC', 'fingerprint' => $fingerprint,
    ])->assertOk()->json('data');

    return ['token' => (string) $data['token'], 'refresh_token' => (string) $data['refresh_token']];
}

/** @return array<string, string> */
function abP5Headers(string $token, string $company): array
{
    return ['Accept' => 'application/json', 'Authorization' => 'Bearer '.$token, 'X-Company-Id' => $company];
}

/**
 * @param  array<string, mixed>|null  $cursor
 * @return array<string, mixed>
 */
function abP5Pull(string $token, string $company, ?array $cursor, int $limit = 1, string $resource = 'sales-quotes'): array
{
    Identity::fresh();
    test()->flushHeaders();

    return test()->withHeaders(abP5Headers($token, $company))
        ->postJson('/api/v1/sync/pull', ['schema_version' => 1, 'resources' => [['resource' => $resource, 'cursor' => $cursor, 'limit' => $limit]]])
        ->assertOk()->json('data.resources.0');
}

/**
 * @param  list<array<string, mixed>>  $mutations
 * @return list<array<string, mixed>>
 */
function abP5Push(string $token, string $company, array $mutations): array
{
    Identity::fresh();
    test()->flushHeaders();

    return test()->withHeaders(abP5Headers($token, $company))
        ->postJson('/api/v1/sync/push', ['schema_version' => 1, 'mutations' => $mutations])->assertOk()->json('data.results');
}

/**
 * @param  array<string, mixed>  $payload
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function abP5Mutation(string $resource, string $op, string $id, array $payload = [], ?int $base = null, array $overrides = []): array
{
    return [
        'idempotency_key' => (string) Str::uuid7(), 'op' => $op, 'resource' => $resource, 'id' => $id,
        'base_version' => $op === 'create' ? null : $base,
        'changed_fields' => $op === 'update' ? array_keys($payload) : [],
        'occurred_at' => '2027-06-14T10:00:00+03:00',
        'payload' => $payload === [] ? new stdClass : $payload,
        ...$overrides,
    ];
}

/** @return list<string> ids of the new quotes */
function abP5Quotes(object $w, int $count): array
{
    $ids = [];

    foreach (range(1, $count) as $i) {
        $ids[] = SalesKit::post($w->user, $w->company, 'sales-quotes', [
            'party_id' => $w->party->id, 'document_date' => '2027-06-10', 'notes' => "Q{$i}",
            'lines' => [['item_id' => $w->item->id, 'quantity' => '1', 'unit_price' => '10']],
        ])->assertCreated()->json('data.id');
    }
    Sync::awaitHorizonPast(DB::transaction(static fn () => Sync::currentTxid()));

    return $ids;
}

it('P5-01 keeps a full download going across a token refresh (session on the device) and ends it on re-login', function (): void {
    $ids = abP5Quotes($this->w, 4);
    $login = abP5Login($this->w->user);
    $first = abP5Pull($login['token'], $this->w->company, null);

    Identity::fresh();
    test()->flushHeaders();
    $refreshed = test()->postJson('/api/v1/auth/device/refresh', ['refresh_token' => $login['refresh_token']])->assertOk()->json('data');
    $second = abP5Pull((string) $refreshed['token'], $this->w->company, $first['next_cursor']);

    expect($first['has_more'])->toBeTrue()->and($second['reset'])->toBeFalse()
        ->and(array_column([...$first['rows'], ...$second['rows']], 'id'))->toBe(array_slice($ids, 0, 2));

    // A new login with the same fingerprint is a new device row: the old session continues nothing.
    $again = abP5Login($this->w->user);
    $third = abP5Pull($again['token'], $this->w->company, $second['next_cursor']);
    expect($third['reset'])->toBeTrue()->and($third['reset_reason'])->toBe('cursor_expired');
});

it('P5-02 does not loop resets: after a reset on a forged session the returned cursor continues', function (): void {
    abP5Quotes($this->w, 4);
    $login = abP5Login($this->w->user);
    $first = abP5Pull($login['token'], $this->w->company, null);
    $forged = [...$first['next_cursor'], 'session' => (string) Str::uuid7()];

    $reset = abP5Pull($login['token'], $this->w->company, $forged);
    $next = abP5Pull($login['token'], $this->w->company, $reset['next_cursor']);
    $after = abP5Pull($login['token'], $this->w->company, $next['next_cursor']);

    expect($reset['reset'])->toBeTrue()
        ->and($next['reset'])->toBeFalse()->and($after['reset'])->toBeFalse()
        ->and($next['rows'][0]['id'])->not->toBe($reset['rows'][0]['id']);
});

it('P5-03 keeps one session row per device and resource however many downloads begin, and none after the last page', function (): void {
    abP5Quotes($this->w, 3);
    $login = abP5Login($this->w->user);

    foreach (range(1, 15) as $ignored) {
        abP5Pull($login['token'], $this->w->company, null);
    }
    expect(DB::table('sync_full_downloads')->count())->toBe(1);

    $page = abP5Pull($login['token'], $this->w->company, null);
    while ($page['has_more']) {
        $page = abP5Pull($login['token'], $this->w->company, $page['next_cursor']);
    }
    expect(DB::table('sync_full_downloads')->count())->toBe(0);
    // The cursor keeps its signed stream tag; only the session row is gone.
    expect($page['has_more'])->toBeFalse();
});

it('P5-04 accepts the latest and the previous cursor of a session only, and a retry does not move it', function (): void {
    $ids = abP5Quotes($this->w, 5);
    $login = abP5Login($this->w->user);
    $p1 = abP5Pull($login['token'], $this->w->company, null);
    $p2 = abP5Pull($login['token'], $this->w->company, $p1['next_cursor']);
    $retry = abP5Pull($login['token'], $this->w->company, $p1['next_cursor']);
    $p3 = abP5Pull($login['token'], $this->w->company, $p2['next_cursor']);

    expect($retry['reset'])->toBeFalse()->and(array_column($retry['rows'], 'id'))->toBe(array_column($p2['rows'], 'id'))
        ->and($p3['reset'])->toBeFalse()->and(array_column($p3['rows'], 'id'))->toBe([$ids[2]]);

    // p1's cursor is now two steps back: neither latest nor previous.
    $stale = abP5Pull($login['token'], $this->w->company, $p1['next_cursor']);
    expect($stale['reset'])->toBeTrue();
});

it('P5-05 resets a session presented by another device of the same user or by another user', function (): void {
    abP5Quotes($this->w, 3);
    $mine = abP5Login($this->w->user, 'fp-abuse-b-p5-mine');
    $first = abP5Pull($mine['token'], $this->w->company, null);

    $otherDevice = abP5Login($this->w->user, 'fp-abuse-b-p5-other');
    $other = Actors::user([...SalesKit::ALL], $this->w->company);
    $otherUser = abP5Login($other, 'fp-abuse-b-p5-otheruser');

    expect(abP5Pull($otherDevice['token'], $this->w->company, $first['next_cursor'])['reset'])->toBeTrue()
        ->and(abP5Pull($otherUser['token'], $this->w->company, $first['next_cursor'])['reset'])->toBeTrue()
        // The owner's session is still intact.
        ->and(abP5Pull($mine['token'], $this->w->company, $first['next_cursor'])['reset'])->toBeFalse();
});

it('P5-06 resets a session whose download began below a raised tombstone floor, and refuses a cursor past the horizon', function (): void {
    abP5Quotes($this->w, 3);
    $login = abP5Login($this->w->user);
    $first = abP5Pull($login['token'], $this->w->company, null);
    $started = DB::table('sync_full_downloads')->selectRaw('started_horizon::text AS s')->value('s');

    // A prune raised the floor past the download's start (sync_watermarks as sync:prune writes it).
    DB::table('sync_watermarks')->insert([
        'resource_table' => 'sales_quotes', 'company_id' => $this->w->company,
        'floor_txid' => DB::raw("'".((int) $started + 1)."'::xid8"), 'pruned_at' => now(),
    ]);
    $after = abP5Pull($login['token'], $this->w->company, $first['next_cursor']);
    expect($after['reset'])->toBeTrue()->and($after['reset_reason'])->toBe('cursor_expired');

    Identity::fresh();
    test()->flushHeaders();
    test()->withHeaders(abP5Headers($login['token'], $this->w->company))->postJson('/api/v1/sync/pull', ['schema_version' => 1, 'resources' => [[
        'resource' => 'sales-quotes', 'cursor' => ['txid' => (string) (PHP_INT_MAX), 'after_id' => null, 'gen' => 0, 'session' => null], 'limit' => 1,
    ]]])->assertStatus(422)->assertJsonPath('errors.code', 'SYNC_CURSOR_INVALID');
});

it('P5-07a a replayed VERSION_CONFLICT names every field changed since base, not only those of the first answer', function (): void {
    [$id] = abP5Quotes($this->w, 1);
    $login = abP5Login($this->w->user);
    $w = $this->w;

    // v2: the web changes notes. Desktop edits notes and document_date on v1: conflict on notes.
    $v2 = SalesKit::patch($w->user, $w->company, "sales-quotes/{$id}", ['version' => 1, 'notes' => 'web notes'])->assertOk()->json('data');
    $edit = abP5Mutation('sales-quotes', 'update', $id, ['notes' => 'desk notes', 'document_date' => '2027-06-09'], 1);
    $conflict = abP5Push($login['token'], $w->company, [$edit])[0];
    // notes plus what document_date derives (lines, totals): document_date itself is not named.
    expect($conflict['conflict'])->toMatchArray(['code' => 'VERSION_CONFLICT', 'server_version' => 2])
        ->and($conflict['conflict']['conflicting_fields'])->toContain('notes')->not->toContain('document_date');

    // v3: the web changes document_date. The answer to the first push was lost: the client retries.
    SalesKit::patch($w->user, $w->company, "sales-quotes/{$id}", ['version' => $v2['version'], 'document_date' => '2027-06-12'])->assertOk();
    $replay = abP5Push($login['token'], $w->company, [$edit])[0];

    expect($replay['replayed'])->toBeTrue()
        ->and($replay['conflict']['server_version'])->toBe(3)
        ->and($replay['conflict']['conflicting_fields'])->toContain('document_date');
});

it('P5-07b a merge built from the replayed conflict does not silently overwrite the web change it was not told about', function (): void {
    [$id] = abP5Quotes($this->w, 1);
    $login = abP5Login($this->w->user);
    $w = $this->w;

    $v2 = SalesKit::patch($w->user, $w->company, "sales-quotes/{$id}", ['version' => 1, 'notes' => 'web notes'])->assertOk()->json('data');
    $edit = abP5Mutation('sales-quotes', 'update', $id, ['notes' => 'desk notes', 'document_date' => '2027-06-09'], 1);
    abP5Push($login['token'], $w->company, [$edit]);
    SalesKit::patch($w->user, $w->company, "sales-quotes/{$id}", ['version' => $v2['version'], 'document_date' => '2027-06-12'])->assertOk();
    $replay = abP5Push($login['token'], $w->company, [$edit])[0]['conflict'];

    // The client asks the user only about conflicting_fields (notes: take the server's) and keeps
    // its other changed fields; base_version is the server_version it was given.
    $merge = [];
    foreach (['notes' => 'desk notes', 'document_date' => '2027-06-09'] as $field => $mine) {
        $merge[$field] = in_array($field, $replay['conflicting_fields'], true) ? $replay['server_data'][$field] : $mine;
    }
    $result = abP5Push($login['token'], $w->company, [abP5Mutation('sales-quotes', 'update', $id, $merge, (int) $replay['server_version'], [
        'resolution' => ['resolves' => $edit['idempotency_key'], 'code' => 'VERSION_CONFLICT', 'choice' => 'merge'],
    ])])[0];

    $stored = (string) DB::table('sales_quotes')->where('id', $id)->value('document_date');
    expect(substr($stored, 0, 10))->toBe('2027-06-12', "merge outcome: {$result['status']}; the web's document_date was replaced without a conflict");
});

it('P5-08 a keep_mine for DUPLICATE_RECORD covers only its own id, its own body and one use', function (): void {
    $login = abP5Login($this->w->user);
    $body = ['name' => 'Acme', 'type' => 'company', 'roles' => ['customer'], 'country' => 'TR'];
    $id = (string) Str::uuid7();
    $create = abP5Mutation('parties', 'create', $id, $body);
    $dup = abP5Push($login['token'], $this->w->company, [$create])[0];
    expect($dup['status'])->toBe('conflict')->and($dup['conflict']['code'])->toBe('DUPLICATE_RECORD');
    $resolution = ['resolves' => $create['idempotency_key'], 'code' => 'DUPLICATE_RECORD', 'choice' => 'keep_mine'];

    // Another id under the same resolution.
    $otherId = abP5Push($login['token'], $this->w->company, [abP5Mutation('parties', 'create', (string) Str::uuid7(), $body, overrides: ['resolution' => $resolution])])[0];
    // Another body (a twin under another spelling) under the same resolution: the search runs again.
    $otherBody = abP5Push($login['token'], $this->w->company, [abP5Mutation('parties', 'create', $id, [...$body, 'name' => 'ACME', 'allow_duplicate' => true], overrides: ['resolution' => $resolution])])[0];
    // The body that got the conflict, keys reordered: created once.
    $same = abP5Push($login['token'], $this->w->company, [abP5Mutation('parties', 'create', $id, array_reverse($body, true), overrides: ['resolution' => $resolution])])[0];
    // A second use of the spent resolution for a fresh id.
    $reuse = abP5Push($login['token'], $this->w->company, [abP5Mutation('parties', 'create', (string) Str::uuid7(), $body, overrides: ['resolution' => $resolution])])[0];

    expect($otherId['status'])->not->toBe('applied')
        ->and($otherBody['status'])->not->toBe('applied')
        ->and($same['status'])->toBe('applied')
        ->and($reuse['status'])->not->toBe('applied')
        ->and(DB::table('parties')->where('company_id', $this->w->company)->whereRaw('lower(name) = ?', ['acme'])->count())->toBe(2);
});

it('P5-09 replays a create whose row was deleted since as duplicate with the stored body (documented client hazard)', function (): void {
    $login = abP5Login($this->w->user);
    $w = $this->w;
    $id = (string) Str::uuid7();
    $create = abP5Mutation('sales-quotes', 'create', $id, ['party_id' => $w->party->id, 'document_date' => '2027-06-10', 'notes' => 'gone soon',
        'lines' => [['item_id' => $w->item->id, 'quantity' => '1', 'unit_price' => '10']]]);
    $applied = abP5Push($login['token'], $w->company, [$create])[0];
    SalesKit::as($w->user, $w->company)->deleteJson("/api/v1/sales-quotes/{$id}?version={$applied['version']}")->assertNoContent();

    $replay = abP5Push($login['token'], $w->company, [$create])[0];

    // Contract behaviour (SYNC-PROTOCOL): duplicate with the first data; the client must not
    // resurrect a row it has no longer. The server writes nothing.
    expect($replay['status'])->toBe('duplicate')->and($replay['replayed'])->toBeTrue()
        ->and(DB::table('sales_quotes')->where('id', $id)->exists())->toBeFalse();
});
