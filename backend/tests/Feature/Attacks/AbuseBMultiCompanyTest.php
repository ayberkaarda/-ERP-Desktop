<?php

declare(strict_types=1);

use App\Modules\Organization\Contracts\CompanyDirectory;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Actors;
use Tests\Support\Identity;
use Tests\Support\Sales\SalesKit;
use Tests\Support\Sync;

/*
 * B3 — one user, two companies (A and B), one desktop device. Every attempt uses the company
 * header of A against B's records, B's idempotency keys, conflicts, cursors and sessions.
 * Committed data (SyncDatabase): pull only reads below the horizon.
 */
uses(SyncDatabase::class);

beforeEach(function (): void {
    $this->a = SalesKit::world(stock: false);
    $this->a->user = SalesKit::user(['parties.view', 'parties.create']);
    $user = $this->a->user;
    $b = Actors::companyFor($user, [...SalesKit::ALL, 'parties.view', 'parties.create']);
    $vat = SalesKit::taxCode($b);
    $unit = SalesKit::unit($b);
    $this->b = (object) [
        'company' => $b, 'user' => $user, 'unit' => $unit, 'vat' => $vat,
        'item' => SalesKit::item($b, ['code' => 'BWIDGET', 'name' => 'B widget', 'default_tax_code_id' => $vat->id], $unit),
        'party' => SalesKit::party($b, ['name' => 'B customer']),
    ];
    $login = test()->postJson('/api/v1/auth/device', [
        'email' => $user->email, 'password' => Identity::PASSWORD, 'device_name' => 'Two companies', 'fingerprint' => 'fp-abuse-b-multi-0001',
    ])->assertOk()->json('data');
    Identity::fresh();
    $this->token = (string) $login['token'];
});

/** @return array<string, string> */
function abCoHeaders(object $test, string $company): array
{
    return ['Accept' => 'application/json', 'Authorization' => 'Bearer '.$test->token, 'X-Company-Id' => $company];
}

/**
 * @param  list<array<string, mixed>>  $mutations
 * @return list<array<string, mixed>>
 */
function abCoPush(object $test, string $company, array $mutations): array
{
    Identity::fresh();
    test()->flushHeaders();

    return test()->withHeaders(abCoHeaders($test, $company))
        ->postJson('/api/v1/sync/push', ['schema_version' => 1, 'mutations' => $mutations])->assertOk()->json('data.results');
}

/**
 * @param  array<string, mixed>|null  $cursor
 * @return array<string, mixed>
 */
function abCoPull(object $test, string $company, string $resource, ?array $cursor, int $limit = 200): array
{
    Identity::fresh();
    test()->flushHeaders();

    return test()->withHeaders(abCoHeaders($test, $company))
        ->postJson('/api/v1/sync/pull', ['schema_version' => 1, 'resources' => [['resource' => $resource, 'cursor' => $cursor, 'limit' => $limit]]])
        ->assertOk()->json('data.resources.0');
}

/**
 * @param  array<string, mixed>  $payload
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function abCoMutation(string $op, string $id, array $payload = [], ?int $base = null, array $overrides = [], string $resource = 'sales-quotes'): array
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

/** @return array<string, mixed> */
function abCoQuote(object $w, string $notes): array
{
    return SalesKit::post($w->user, $w->company, 'sales-quotes', [
        'party_id' => $w->party->id, 'document_date' => '2027-06-10', 'notes' => $notes,
        'lines' => [['item_id' => $w->item->id, 'quantity' => '2', 'unit_price' => '120']],
    ])->assertCreated()->json('data');
}

function abCoSettle(): void
{
    Sync::awaitHorizonPast(DB::transaction(static fn () => Sync::currentTxid()));
}

it('B3-01 cannot update or delete a record of company B while the header names A, and B is untouched', function (): void {
    $qb = abCoQuote($this->b, 'B original');
    $before = (array) DB::table('sales_quotes')->where('id', $qb['id'])->first();

    $results = abCoPush($this, $this->a->company, [
        abCoMutation('update', $qb['id'], ['notes' => 'from A'], (int) $qb['version']),
        abCoMutation('delete', $qb['id'], base: (int) $qb['version']),
    ]);

    expect($results[0]['status'])->toBe('rejected')->and($results[0]['error']['code'])->toBe('NOT_FOUND')
        ->and($results[1]['status'])->toBe('rejected')->and($results[1]['error']['code'])->toBeIn(['NOT_FOUND', 'SYNC_DEPENDENCY_FAILED'])
        ->and(json_encode($results))->not->toContain('B original')
        ->and((array) DB::table('sales_quotes')->where('id', $qb['id'])->first())->toBe($before);
});

it('B3-02 never replays a result stored in company B for the same key under the header of A', function (): void {
    $qb = abCoQuote($this->b, 'B original');
    $edit = abCoMutation('update', $qb['id'], ['notes' => 'B secret edit'], (int) $qb['version']);
    expect(abCoPush($this, $this->b->company, [$edit])[0]['status'])->toBe('applied');

    // Same key, same body, header A: no replay of B's stored body (it carries B's row).
    $again = abCoPush($this, $this->a->company, [$edit])[0];
    expect($again['replayed'] ?? false)->toBeFalse()
        ->and($again['status'])->toBe('rejected')->and($again['error']['code'])->toBe('NOT_FOUND')
        ->and(json_encode($again))->not->toContain('B secret edit');

    // A create replayed under A with the key of a create applied in B: no replay, the id is taken.
    $id = (string) Str::uuid7();
    $create = abCoMutation('create', $id, ['party_id' => $this->b->party->id, 'document_date' => '2027-06-10', 'notes' => 'B created',
        'lines' => [['item_id' => $this->b->item->id, 'quantity' => '1', 'unit_price' => '5']]]);
    expect(abCoPush($this, $this->b->company, [$create])[0]['status'])->toBe('applied');
    $cross = abCoPush($this, $this->a->company, [$create])[0];
    expect($cross['replayed'] ?? false)->toBeFalse()->and($cross['status'])->toBe('rejected')
        ->and($cross['error']['code'])->toBe('VALIDATION_ERROR')
        ->and(json_encode($cross))->not->toContain('B created');
});

it('B3-03 answers a create on an id of company B like any taken id, and plants nothing in A', function (): void {
    $qb = abCoQuote($this->b, 'B original');
    $qa = abCoQuote($this->a, 'A original');
    $payload = ['party_id' => $this->a->party->id, 'document_date' => '2027-06-10', 'lines' => [['item_id' => $this->a->item->id, 'quantity' => '1', 'unit_price' => '5']]];

    $foreign = abCoPush($this, $this->a->company, [abCoMutation('create', $qb['id'], $payload)])[0];
    $own = abCoPush($this, $this->a->company, [abCoMutation('create', $qa['id'], $payload)])[0];

    expect($foreign['error'])->toBe($own['error'])
        ->and(DB::table('sales_quotes')->where('id', $qb['id'])->value('company_id'))->toBe($this->b->company);
});

it('B3-04 resolves no conflict of company B from A and leaves it resolvable in B', function (): void {
    $qb = abCoQuote($this->b, 'B original');
    // A web change in B, then a stale offline edit in B: a VERSION_CONFLICT stored in B.
    $web = SalesKit::patch($this->b->user, $this->b->company, "sales-quotes/{$qb['id']}", ['version' => $qb['version'], 'notes' => 'B web'])->assertOk()->json('data');
    $stale = abCoMutation('update', $qb['id'], ['notes' => 'B offline'], (int) $qb['version']);
    $conflict = abCoPush($this, $this->b->company, [$stale])[0];
    expect($conflict['status'])->toBe('conflict')->and($conflict['conflict']['code'])->toBe('VERSION_CONFLICT');
    $resolution = ['resolves' => $stale['idempotency_key'], 'code' => 'VERSION_CONFLICT', 'choice' => 'keep_mine'];

    $qa = abCoQuote($this->a, 'A original');
    $onOwn = abCoPush($this, $this->a->company, [abCoMutation('update', $qa['id'], ['notes' => 'A forced'], 1, ['resolution' => $resolution])])[0];
    $onForeign = abCoPush($this, $this->a->company, [abCoMutation('update', $qb['id'], ['notes' => 'A forced'], (int) $web['version'], ['resolution' => $resolution])])[0];

    expect($onOwn['status'])->toBe('rejected')->and($onOwn['error']['code'])->toBe('SYNC_RESOLUTION_INVALID')
        ->and($onForeign['status'])->toBe('rejected')->and($onForeign['error']['code'])->toBe('NOT_FOUND')
        ->and(DB::table('sales_quotes')->where('id', $qb['id'])->value('notes'))->toBe('B web')
        ->and(DB::table('sales_quotes')->where('id', $qa['id'])->value('notes'))->toBe('A original');

    // The conflict in B is still there for its owner.
    $resolved = abCoPush($this, $this->b->company, [abCoMutation('update', $qb['id'], ['notes' => 'B offline'], (int) $web['version'], ['resolution' => $resolution])])[0];
    expect($resolved['status'])->toBe('applied');
});

it('B3-05 refuses depends_on keys of company B under the header of A', function (): void {
    $qb = abCoQuote($this->b, 'B original');
    $edit = abCoMutation('update', $qb['id'], ['notes' => 'B edit'], (int) $qb['version']);
    expect(abCoPush($this, $this->b->company, [$edit])[0]['status'])->toBe('applied');

    $qa = abCoQuote($this->a, 'A original');
    $dependent = abCoPush($this, $this->a->company, [abCoMutation('update', $qa['id'], ['notes' => 'A dep'], (int) $qa['version'], ['depends_on' => [$edit['idempotency_key']]])])[0];

    expect($dependent['status'])->toBe('rejected')->and($dependent['error']['code'])->toBe('VALIDATION_ERROR')
        ->and($dependent['error']['fields'])->toHaveKey('depends_on');
});

it('B3-06 pulls in A no row, embedded line or tombstone of B, for quotes and parties', function (): void {
    $qa = abCoQuote($this->a, 'A visible');
    $qb = abCoQuote($this->b, 'B hidden');
    $gone = abCoQuote($this->b, 'B deleted');
    SalesKit::as($this->b->user, $this->b->company)->deleteJson("/api/v1/sales-quotes/{$gone['id']}?version={$gone['version']}")->assertNoContent();
    $bLines = DB::table('sales_quote_lines')->where('document_id', $qb['id'])->pluck('id')->all();
    abCoSettle();

    $quotes = abCoPull($this, $this->a->company, 'sales-quotes', null);
    $parties = abCoPull($this, $this->a->company, 'parties', null);
    $wire = json_encode([$quotes, $parties]);
    $bQuotes = abCoPull($this, $this->b->company, 'sales-quotes', null);

    expect(array_column($quotes['rows'], 'id'))->toBe([$qa['id']])
        ->and(array_column($quotes['tombstones'], 'id'))->not->toContain($gone['id'])
        ->and(array_column($parties['rows'], 'id'))->not->toContain($this->b->party->id)
        ->and($wire)->not->toContain($qb['id'])->not->toContain($gone['id'])->not->toContain($this->b->party->id)->not->toContain('B hidden');
    foreach ($bLines as $line) {
        expect($wire)->not->toContain($line);
    }
    // Control: B's own pull has them.
    expect(array_column($bQuotes['rows'], 'id'))->toContain($qb['id'])
        ->and(array_column($bQuotes['tombstones'], 'id'))->toContain($gone['id']);
});

it('B3-07 resets a full download session of B presented under A, and B continues untouched', function (): void {
    foreach (range(1, 3) as $i) {
        abCoQuote($this->b, "B {$i}");
    }
    $qa = abCoQuote($this->a, 'A only');
    abCoSettle();

    $first = abCoPull($this, $this->b->company, 'sales-quotes', null, 1);
    expect($first['has_more'])->toBeTrue()->and($first['next_cursor']['session'])->toBeString();

    $cross = abCoPull($this, $this->a->company, 'sales-quotes', $first['next_cursor'], 1);
    expect($cross['reset'])->toBeTrue()
        ->and(array_column($cross['rows'], 'id'))->toBe([$qa['id']]);

    // B's session was not touched by A's request.
    $second = abCoPull($this, $this->b->company, 'sales-quotes', $first['next_cursor'], 1);
    expect($second['reset'])->toBeFalse()->and($second['rows'])->toHaveCount(1)
        ->and($second['rows'][0]['company_id'] ?? $this->b->company)->toBe($this->b->company);
});

it('B3-08 an incremental cursor of B used under A only narrows what A sends, never adds B rows', function (): void {
    $qb = abCoQuote($this->b, 'B 1');
    abCoSettle();
    $bDone = abCoPull($this, $this->b->company, 'sales-quotes', null);
    $qa = abCoQuote($this->a, 'A later');
    abCoSettle();

    $cross = abCoPull($this, $this->a->company, 'sales-quotes', $bDone['next_cursor']);
    $ids = array_column($cross['rows'], 'id');

    expect($ids)->not->toContain($qb['id'])->and(json_encode($cross))->not->toContain($qb['id']);
    expect(in_array($qa['id'], $ids, true) || $cross['reset'] === true)->toBeTrue();
});

it('B3-09 a membership taken away in B stops B on the same device token while A goes on', function (): void {
    $qb = abCoQuote($this->b, 'B 1');
    abCoSettle();
    $page = abCoPull($this, $this->b->company, 'sales-quotes', null);
    DB::transaction(fn () => app(CompanyDirectory::class)->setMembership($this->b->user->id, $this->b->company, false));

    Identity::fresh();
    test()->flushHeaders();
    test()->withHeaders(abCoHeaders($this, $this->b->company))
        ->postJson('/api/v1/sync/pull', ['schema_version' => 1, 'resources' => [['resource' => 'sales-quotes', 'cursor' => $page['next_cursor'], 'limit' => 10]]])
        ->assertForbidden();
    $push = (function () use ($qb) {
        Identity::fresh();
        test()->flushHeaders();

        return test()->withHeaders(abCoHeaders($this, $this->b->company))
            ->postJson('/api/v1/sync/push', ['schema_version' => 1, 'mutations' => [abCoMutation('update', $qb['id'], ['notes' => 'after removal'], (int) $qb['version'])]]);
    })->call($this);

    expect($push->status())->toBe(403)
        ->and(DB::table('sales_quotes')->where('id', $qb['id'])->value('notes'))->toBe('B 1')
        ->and(abCoPull($this, $this->a->company, 'sales-quotes', null)['reset'])->toBeFalse();
});
