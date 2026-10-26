<?php

declare(strict_types=1);

use App\Core\Sync\Xid8;
use App\Modules\Organization\Models\Company;
use App\Modules\Parties\Models\Party;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Feature\Sync\Support\SyncKit;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Catalog\Catalog;
use Tests\Support\Identity;
use Tests\Support\Sales\SalesKit;

/*
 * The desktop client's whole round trip against the shipped contracts/offline-manifest.json and
 * the real module adapters: device login, manifest, full download (session), incremental pull,
 * push outcomes, a web REST change meeting an offline edit, token refresh and revocation in the
 * middle of a download, and a transaction that is still open while a pull runs.
 */
uses(SyncDatabase::class);

beforeEach(function (): void {
    $this->w = SalesKit::world(stock: false);
    $this->w->user = SalesKit::user(['parties.view', 'parties.create']);
    $list = SalesKit::priceList($this->w->company, ['is_default' => true]);
    Catalog::line($this->w->company, $list, $this->w->item, $this->w->unit, '120');
    $this->fingerprint = 'fp-e2e-desktop-0001';
});

/**
 * POST /auth/device as the desktop app does it.
 *
 * @return array{token: string, refresh_token: string}
 */
function e2eLogin(object $test, string $fingerprint): array
{
    Identity::fresh();
    $data = $test->postJson('/api/v1/auth/device', [
        'email' => $test->w->user->email,
        'password' => Identity::PASSWORD,
        'device_name' => 'Kasa PC',
        'fingerprint' => $fingerprint,
    ])->assertOk()->json('data');

    return ['token' => (string) $data['token'], 'refresh_token' => (string) $data['refresh_token']];
}

/** @return array<string, string> */
function e2eHeaders(object $test, string $token): array
{
    return ['Accept' => 'application/json', 'Authorization' => 'Bearer '.$token, 'X-Company-Id' => $test->w->company];
}

/**
 * One pull page of one resource, validated against the wire schema.
 *
 * @param  array<string, mixed>|null  $cursor
 * @return array<string, mixed>
 */
function e2ePull(object $test, string $token, string $resource, ?array $cursor, int $limit = 200): array
{
    $response = SyncKit::pull($test, [['resource' => $resource, 'cursor' => $cursor, 'limit' => $limit]], e2eHeaders($test, $token))->assertOk();

    return SyncKit::wire($response, 'sync/pull.response.schema.json')['data']['resources'][0];
}

/**
 * Pages until has_more is false; returns the row ids in pull order and the final cursor.
 *
 * @param  array<string, mixed>|null  $cursor
 * @return array{ids: list<string>, rows: list<array<string, mixed>>, cursor: array<string, mixed>, pages: list<array<string, mixed>>}
 */
function e2eDrain(object $test, string $token, string $resource, ?array $cursor, int $limit = 200): array
{
    $pages = [];

    do {
        $page = e2ePull($test, $token, $resource, $cursor, $limit);
        $pages[] = $page;
        $cursor = $page['next_cursor'];
    } while ($page['has_more']);

    $rows = array_merge(...array_column($pages, 'rows'));

    return ['ids' => array_column($rows, 'id'), 'rows' => $rows, 'cursor' => $cursor, 'pages' => $pages];
}

/**
 * @param  list<array<string, mixed>>  $mutations
 * @return list<array<string, mixed>>
 */
function e2ePush(object $test, string $token, array $mutations): array
{
    $response = SyncKit::push($test, $mutations, e2eHeaders($test, $token))->assertOk();

    return SyncKit::wire($response, 'sync/push.response.schema.json')['data']['results'];
}

/**
 * @param  array<string, mixed>  $payload
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function e2eMutation(string $resource, string $op, string $id, array $payload = [], ?int $base = null, array $overrides = []): array
{
    return [
        'idempotency_key' => (string) Str::uuid7(),
        'op' => $op,
        'resource' => $resource,
        'id' => $id,
        'base_version' => $op === 'create' ? null : $base,
        'changed_fields' => $op === 'update' ? array_keys($payload) : [],
        'occurred_at' => '2027-06-14T10:00:00+03:00',
        'payload' => $payload === [] ? new stdClass : $payload,
        ...$overrides,
    ];
}

/** @return array<string, mixed> */
function e2eQuotePayload(object $test, string $quantity = '2'): array
{
    return ['party_id' => $test->w->party->id, 'document_date' => '2027-06-10', 'lines' => [['item_id' => $test->w->item->id, 'quantity' => $quantity]]];
}

/** @return array<string, mixed> */
function e2eWebQuote(object $test, string $notes): array
{
    return SalesKit::post($test->w->user, $test->w->company, 'sales-quotes', [...e2eQuotePayload($test), 'notes' => $notes])->assertCreated()->json('data');
}

it('walks login, manifest, full download, incremental pull, push outcomes and a web change to a conflict', function (): void {
    $webA = e2eWebQuote($this, 'web A');
    $webB = e2eWebQuote($this, 'web B');
    $webC = e2eWebQuote($this, 'web C');
    SyncKit::waitVisible();

    // 1. Device login and manifest of the shipped offline manifest.
    $login = e2eLogin($this, $this->fingerprint);
    $manifest = SyncKit::wire(SyncKit::manifestOf($this, e2eHeaders($this, $login['token']))->assertOk(), 'sync/manifest.response.schema.json')['data'];
    $byName = array_column($manifest['resources'], null, 'resource');

    expect($manifest['company_id'])->toBe($this->w->company)
        ->and($manifest['user_id'])->toBe($this->w->user->id)
        ->and($byName['sales-quotes']['writable'])->toBe(['create', 'update', 'delete'])
        ->and($byName['parties']['writable'])->toBe(['create'])
        ->and($byName)->not->toHaveKey('purchase-requests')
        ->and($byName)->not->toHaveKey('stock-documents');

    // 2. Full download in pages of one: a session while has_more, null at the end.
    $full = e2eDrain($this, $login['token'], 'sales-quotes', null, 1);
    $sessions = array_map(fn (array $p): mixed => $p['next_cursor']['session'], $full['pages']);

    expect($full['ids'])->toEqualCanonicalizing([$webA['id'], $webB['id'], $webC['id']])
        ->and(array_column($full['pages'], 'reset'))->each->toBeFalse()
        ->and(array_slice($sessions, 0, -1))->each->toBeString()
        ->and(count(array_unique(array_slice($sessions, 0, -1))))->toBe(1)
        ->and(end($sessions))->toBeNull()
        ->and($full['rows'][0])->toHaveKeys(['id', 'version', 'status', 'lines']);

    // 3. Incremental pull without changes is empty and keeps a null session.
    $quiet = e2ePull($this, $login['token'], 'sales-quotes', $full['cursor']);
    expect($quiet['rows'])->toBe([])->and($quiet['has_more'])->toBeFalse()->and($quiet['next_cursor']['session'])->toBeNull();

    // 4. Web REST: one quote leaves draft (send), one is edited after the device downloaded it.
    SalesKit::post($this->w->user, $this->w->company, "sales-quotes/{$webB['id']}/send")->assertOk();
    $webEdit = SalesKit::patch($this->w->user, $this->w->company, "sales-quotes/{$webC['id']}", ['version' => $webC['version'], 'notes' => 'changed on the web'])->assertOk()->json('data');

    // 5. Push: offline create, current update, stale update meeting the web edit, locked
    //    document, a rejected mutation and a duplicate party.
    $offlineId = (string) Str::uuid7();
    $partyId = (string) Str::uuid7();
    $create = e2eMutation('sales-quotes', 'create', $offlineId, e2eQuotePayload($this, '3'));
    $update = e2eMutation('sales-quotes', 'update', $webA['id'], ['notes' => 'offline A'], $webA['version']);
    $stale = e2eMutation('sales-quotes', 'update', $webC['id'], ['notes' => 'offline C'], $webC['version']);
    $locked = e2eMutation('sales-quotes', 'update', $webB['id'], ['notes' => 'offline B'], $webB['version']);
    $mismatch = e2eMutation('sales-quotes', 'update', $webA['id'], ['notes' => 'x'], $webA['version'] + 1, ['changed_fields' => ['valid_until']]);
    $duplicate = e2eMutation('parties', 'create', $partyId, ['name' => $this->w->party->name, 'type' => 'company', 'roles' => ['customer']]);

    $results = e2ePush($this, $login['token'], [$create, $update, $stale, $locked, $mismatch, $duplicate]);

    expect(array_column($results, 'status'))->toBe(['applied', 'applied', 'conflict', 'conflict', 'rejected', 'conflict'])
        ->and($results[0]['data'])->toMatchArray(['id' => $offlineId, 'status' => 'draft', 'number' => null])
        ->and($results[1]['data']['notes'])->toBe('offline A')
        ->and($results[2]['conflict'])->toMatchArray(['code' => 'VERSION_CONFLICT', 'base_version' => $webC['version'], 'server_version' => $webEdit['version']])
        ->and($results[2]['conflict']['conflicting_fields'])->toContain('notes')
        ->and($results[2]['conflict']['server_data']['notes'])->toBe('changed on the web')
        ->and($results[3]['conflict'])->toMatchArray(['code' => 'DOCUMENT_LOCKED', 'choices' => ['save_as_new_draft', 'discard']])
        ->and($results[3]['conflict']['server_data']['status'])->toBe('sent')
        ->and($results[4]['error']['code'])->toBe('SYNC_CHANGED_FIELDS_MISMATCH')
        ->and($results[5]['conflict']['code'])->toBe('DUPLICATE_RECORD')
        ->and($results[5]['conflict']['candidates'])->toBe([$this->w->party->id]);

    // The web REST edit of the locked quote answers the same lock.
    SalesKit::patch($this->w->user, $this->w->company, "sales-quotes/{$webB['id']}", ['version' => $webB['version'] + 1, 'notes' => 'web'])
        ->assertStatus(409)->assertJsonPath('errors.code', 'DOCUMENT_LOCKED');

    // 6. Conflict Inbox decisions: keep_mine on the stored conflicts, a new draft for the lock.
    $keepVersion = e2eMutation('sales-quotes', 'update', $webC['id'], ['notes' => 'offline C'], $results[2]['conflict']['server_version'], [
        'resolution' => ['resolves' => $stale['idempotency_key'], 'code' => 'VERSION_CONFLICT', 'choice' => 'keep_mine'],
    ]);
    $keepParty = e2eMutation('parties', 'create', $partyId, $duplicate['payload'], overrides: [
        'resolution' => ['resolves' => $duplicate['idempotency_key'], 'code' => 'DUPLICATE_RECORD', 'choice' => 'keep_mine'],
    ]);
    $newDraftId = (string) Str::uuid7();
    $newDraft = e2eMutation('sales-quotes', 'create', $newDraftId, [...e2eQuotePayload($this), 'notes' => 'offline B']);

    $decided = e2ePush($this, $login['token'], [$keepVersion, $keepParty, $newDraft]);

    expect(array_column($decided, 'status'))->toBe(['applied', 'applied', 'applied'])
        ->and($decided[0]['version'])->toBe($webEdit['version'] + 1)
        ->and($decided[0]['data']['notes'])->toBe('offline C')
        ->and($decided[1]['data']['id'])->toBe($partyId)
        ->and(Party::withoutGlobalScopes()->where('company_id', $this->w->company)->count())->toBe(2);

    // A retry of the first batch replays every stored outcome.
    $replayed = e2ePush($this, $login['token'], [$create, $update, $stale, $locked, $duplicate]);
    expect(array_column($replayed, 'status'))->toBe(['duplicate', 'duplicate', 'conflict', 'conflict', 'conflict'])
        ->and(array_column($replayed, 'replayed'))->each->toBeTrue();

    // 7. The next incremental pull brings exactly what changed since the download.
    SyncKit::waitVisible();
    $after = e2eDrain($this, $login['token'], 'sales-quotes', $full['cursor']);
    $rows = array_column($after['rows'], null, 'id');

    expect(array_keys($rows))->toEqualCanonicalizing([$webA['id'], $webB['id'], $webC['id'], $offlineId, $newDraftId])
        ->and($rows[$webA['id']]['notes'])->toBe('offline A')
        ->and($rows[$webB['id']]['status'])->toBe('sent')
        ->and($rows[$webC['id']]['notes'])->toBe('offline C')
        ->and($rows[$webC['id']]['version'])->toBe($decided[0]['version'])
        ->and($after['pages'][0]['reset'])->toBeFalse();

    $parties = e2eDrain($this, $login['token'], 'parties', null);
    expect($parties['ids'])->toEqualCanonicalizing([$this->w->party->id, $partyId]);
});

it('keeps a full download across a token refresh and drops it when the device is revoked', function (): void {
    foreach (['one', 'two', 'three'] as $notes) {
        e2eWebQuote($this, $notes);
    }
    SyncKit::waitVisible();

    $login = e2eLogin($this, $this->fingerprint);
    $other = e2eLogin($this, 'fp-e2e-desktop-0002');
    $first = e2ePull($this, $login['token'], 'sales-quotes', null, 1);
    $otherFirst = e2ePull($this, $other['token'], 'sales-quotes', null, 1);

    // Refresh through the real endpoint between two pages: the session belongs to the device.
    Identity::fresh();
    $rotated = $this->postJson('/api/v1/auth/device/refresh', ['refresh_token' => $login['refresh_token']])->assertOk()->json('data');
    $second = e2ePull($this, (string) $rotated['token'], 'sales-quotes', $first['next_cursor'], 1);

    expect($first['has_more'])->toBeTrue()
        ->and($second['reset'])->toBeFalse()
        ->and($second['next_cursor']['session'])->toBe($first['next_cursor']['session']);

    // The old access token is gone after the refresh.
    Identity::fresh();
    $this->withHeaders(e2eHeaders($this, $login['token']))->getJson('/api/v1/sync/manifest')->assertUnauthorized();

    // Revoking the first device from the second one ends its session; the second device's
    // download is untouched.
    $device = SyncKit::wire(SyncKit::manifestOf($this, e2eHeaders($this, (string) $rotated['token']))->assertOk(), 'sync/manifest.response.schema.json')['data']['device_id'];
    Identity::fresh();
    $this->withHeaders(e2eHeaders($this, $other['token']))->deleteJson("/api/v1/me/devices/{$device}")->assertSuccessful();

    Identity::fresh();
    $this->withHeaders(e2eHeaders($this, (string) $rotated['token']))->postJson('/api/v1/sync/pull', [
        'schema_version' => 1, 'resources' => [['resource' => 'sales-quotes', 'cursor' => $second['next_cursor'], 'limit' => 1]],
    ])->assertUnauthorized();

    expect(DB::table('sync_full_downloads')->where('device_id', $device)->count())->toBe(0);

    $otherRest = e2eDrain($this, $other['token'], 'sales-quotes', $otherFirst['next_cursor'], 1);
    expect($otherRest['pages'][0]['reset'])->toBeFalse()
        ->and(count($otherFirst['rows']) + count($otherRest['ids']))->toBe(3);
});

it('never moves the cursor past a transaction that is still open on another connection', function (): void {
    $early = e2eWebQuote($this, 'early');
    $late = e2eWebQuote($this, 'late');
    SyncKit::waitVisible();

    $login = e2eLogin($this, $this->fingerprint);
    $download = e2eDrain($this, $login['token'], 'sales-quotes', null);
    expect($download['ids'])->toEqualCanonicalizing([$early['id'], $late['id']]);

    // A second connection writes the early quote and keeps its transaction open.
    config(['database.connections.e2e_side' => config('database.connections.'.config('database.default'))]);
    $side = DB::connection('e2e_side');
    $side->beginTransaction();

    try {
        $side->table('sales_quotes')->where('id', $early['id'])->update(['notes' => 'written by the open transaction']);
        $sideTxid = $side->selectOne('SELECT pg_current_xact_id()::text AS v')->v;

        // Meanwhile the web commits a later change of the other quote.
        SalesKit::patch($this->w->user, $this->w->company, "sales-quotes/{$late['id']}", ['version' => $late['version'], 'notes' => 'late, committed'])->assertOk();

        $during = e2ePull($this, $login['token'], 'sales-quotes', $download['cursor']);

        // Neither change may be delivered yet: the committed one sits above the open
        // transaction, and the cursor must stay at or below the open transaction.
        expect($during['rows'])->toBe([])
            ->and($during['has_more'])->toBeFalse()
            ->and(Xid8::of($during['next_cursor']['txid'])->greaterThan(Xid8::of($sideTxid)))->toBeFalse();

        $side->commit();
    } finally {
        if ($side->transactionLevel() > 0) {
            $side->rollBack();
        }
        $side->disconnect();
    }

    SyncKit::waitVisible();
    $rows = array_column(e2eDrain($this, $login['token'], 'sales-quotes', $during['next_cursor'])['rows'], null, 'id');

    expect(array_keys($rows))->toEqualCanonicalizing([$early['id'], $late['id']])
        ->and($rows[$early['id']]['notes'])->toBe('written by the open transaction')
        ->and($rows[$late['id']]['notes'])->toBe('late, committed');
});

it('binds a parties keep_mine resolution to the stored DUPLICATE_RECORD conflict only', function (): void {
    $login = e2eLogin($this, $this->fingerprint);
    $id = (string) Str::uuid7();
    $payload = ['name' => $this->w->party->name, 'type' => 'company', 'roles' => ['customer']];
    $create = e2eMutation('parties', 'create', $id, $payload);
    $resolution = ['resolves' => $create['idempotency_key'], 'code' => 'DUPLICATE_RECORD', 'choice' => 'keep_mine'];

    // keep_mine before any conflict was stored, or pointing at an unknown key.
    $early = e2ePush($this, $login['token'], [e2eMutation('parties', 'create', $id, $payload, overrides: ['resolution' => $resolution])]);
    expect($early[0]['error']['code'])->toBe('SYNC_RESOLUTION_INVALID');

    $conflict = e2ePush($this, $login['token'], [$create])[0];
    expect($conflict['conflict']['code'])->toBe('DUPLICATE_RECORD');

    $unknown = ['resolution' => [...$resolution, 'resolves' => (string) Str::uuid7()]];
    $otherId = ['resolution' => $resolution];
    $wrongCode = ['resolution' => [...$resolution, 'code' => 'VERSION_CONFLICT']];
    // One push each: in one batch a later mutation of the same id would wait on the earlier one.
    $invalid = array_map(fn (array $m): array => e2ePush($this, $login['token'], [$m])[0], [
        e2eMutation('parties', 'create', $id, $payload, overrides: $unknown),
        e2eMutation('parties', 'create', (string) Str::uuid7(), $payload, overrides: $otherId),
        e2eMutation('parties', 'create', $id, $payload, overrides: $wrongCode),
    ]);

    expect(array_map(fn (array $r): string => $r['error']['code'], $invalid))->toBe(['SYNC_RESOLUTION_INVALID', 'SYNC_RESOLUTION_INVALID', 'SYNC_RESOLUTION_INVALID'])
        ->and(Party::withoutGlobalScopes()->whereKey($id)->exists())->toBeFalse();

    // Another user of the same company cannot resolve this user's conflict.
    $colleague = SalesKit::user(['parties.view', 'parties.create']);
    $colleagueToken = SyncKit::headers($colleague, Company::query()->findOrFail($this->w->company));
    $foreign = SyncKit::wire(SyncKit::push($this, [e2eMutation('parties', 'create', $id, $payload, overrides: ['resolution' => $resolution])], $colleagueToken)->assertOk(), 'sync/push.response.schema.json')['data']['results'][0];
    expect($foreign['error']['code'])->toBe('SYNC_RESOLUTION_INVALID');

    // The real resolution applies once and supersedes the stored conflict.
    $keep = e2eMutation('parties', 'create', $id, $payload, overrides: ['resolution' => $resolution]);
    $applied = e2ePush($this, $login['token'], [$keep])[0];
    $again = e2ePush($this, $login['token'], [e2eMutation('parties', 'create', $id, $payload, overrides: ['resolution' => $resolution])])[0];

    expect($applied['status'])->toBe('applied')
        ->and($applied['data']['id'])->toBe($id)
        ->and(DB::table('sync_push_resolutions')->where('resolved_key', $create['idempotency_key'])->value('superseded_by'))->toBe($keep['idempotency_key'])
        ->and($again['error']['code'])->toBe('SYNC_RESOLUTION_INVALID')
        ->and(e2ePush($this, $login['token'], [$create])[0]['conflict']['code'])->toBe('DUPLICATE_RECORD')
        ->and(e2ePush($this, $login['token'], [$keep])[0])->toMatchArray(['status' => 'duplicate', 'replayed' => true]);
});
