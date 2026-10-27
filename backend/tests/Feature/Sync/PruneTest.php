<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Core\Sync\Cursor;
use App\Core\Sync\Xid8;
use App\Modules\Sync\Services\CursorTags;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Feature\Sync\Support\SyncKit;
use Tests\Fixtures\Sync\FixtureNote;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Sync;

uses(SyncDatabase::class);

beforeEach(function (): void {
    SyncKit::boot();
    [$this->company, $this->user] = SyncKit::actor(['fixtures.view']);
    $this->headers = SyncKit::headers($this->user, $this->company);
});

function deleteNote(object $test, string $title, int $daysAgo): FixtureNote
{
    $note = SyncKit::note($test->company, ['title' => $title]);
    app(CompanyContext::class)->runAs($test->company->id, fn () => FixtureNote::query()->findOrFail($note->id)->delete());
    DB::table('sync_tombstones')->where('row_id', $note->id)->update(['deleted_at' => Carbon::now()->subDays($daysAgo)]);

    return $note;
}

function floorOf(string $company): ?string
{
    $value = DB::table('sync_watermarks')->where('resource_table', 'sync_fixture_notes')->where('company_id', $company)->selectRaw('floor_txid::text AS f')->value('f');

    return is_string($value) ? $value : null;
}

/**
 * @param  array<string, mixed>|null  $cursor
 * @return array<string, mixed>
 */
function pullPage(object $test, ?array $cursor): array
{
    return SyncKit::wire(SyncKit::pull($test, [['resource' => 'fixture-notes', 'cursor' => $cursor]], $test->headers)->assertOk(), 'sync/pull.response.schema.json')['data']['resources'][0];
}

it('prunes old tombstones, raises the floor past them and expires older cursors', function (): void {
    // A real incremental cursor issued while Old was still alive: it has not seen the delete.
    $old = SyncKit::note($this->company, ['title' => 'Old']);
    SyncKit::waitVisible();
    $before = pullPage($this, null)['next_cursor'];

    app(CompanyContext::class)->runAs($this->company->id, fn () => FixtureNote::query()->findOrFail($old->id)->delete());
    DB::table('sync_tombstones')->where('row_id', $old->id)->update(['deleted_at' => Carbon::now()->subDays(100)]);
    $young = deleteNote($this, 'Young', 10);
    $oldTxid = Xid8::of((string) Sync::tombstone('sync_fixture_notes', $old->id)?->sync_txid);
    SyncKit::waitVisible();
    // A real incremental cursor issued after both deletes.
    $after = pullPage($this, null)['next_cursor'];

    $this->artisan('sync:prune')->assertSuccessful();

    expect(Sync::tombstone('sync_fixture_notes', $old->id))->toBeNull()
        ->and(Sync::tombstone('sync_fixture_notes', $young->id))->not->toBeNull()
        ->and(floorOf($this->company->id))->toBe($oldTxid->next()->value)
        ->and(Xid8::of((string) $before['txid'])->value)->not->toBe($oldTxid->next()->value);

    // The cursor from before the pruned delete has missed it.
    $page = pullPage($this, $before);
    expect($page['reset'])->toBeTrue()
        ->and($page['reset_reason'])->toBe('cursor_expired')
        ->and(array_column($page['tombstones'], 'id'))->toBe([$young->id]);

    // Past the floor nothing was missed; a first download is never expired.
    expect(pullPage($this, $after)['reset'])->toBeFalse()
        ->and(pullPage($this, null)['reset'])->toBeFalse();
});

it('only raises the floor and leaves other companies alone', function (): void {
    // A real cursor of another company, issued before this company's deletes and prunes.
    [$other, $otherUser] = SyncKit::actor(['fixtures.view']);
    $headers = SyncKit::headers($otherUser, $other);
    $otherPull = fn (?array $cursor): array => SyncKit::wire(SyncKit::pull($this, [['resource' => 'fixture-notes', 'cursor' => $cursor]], $headers)->assertOk(), 'sync/pull.response.schema.json')['data']['resources'][0];
    SyncKit::waitVisible();
    $otherCursor = $otherPull(null)['next_cursor'];

    $first = deleteNote($this, 'First', 100);
    $this->artisan('sync:prune')->assertSuccessful();
    $floor = floorOf($this->company->id);

    // A tombstone with a smaller sync_txid pruned later cannot lower the floor.
    $second = deleteNote($this, 'Second', 100);
    DB::statement("UPDATE sync_tombstones SET sync_txid = '1'::xid8 WHERE row_id = ?", [$second->id]);
    $this->artisan('sync:prune')->assertSuccessful();

    expect(floorOf($this->company->id))->toBe($floor)
        ->and(DB::table('sync_watermarks')->count())->toBe(1)
        ->and(Sync::tombstone('sync_fixture_notes', $first->id))->toBeNull()
        ->and(Xid8::of((string) $otherCursor['txid'])->value)->not->toBe($floor);

    expect($otherPull($otherCursor)['reset'])->toBeFalse();
});

it('keeps a tagged cursor at or above the floor valid however long it was not used', function (): void {
    SyncKit::note($this->company, ['title' => 'Kept']);
    deleteNote($this, 'Pruned', 100);
    SyncKit::waitVisible();
    $cursor = pullPage($this, null)['next_cursor'];

    // A hundred days offline: the retention passes, tombstones and old sessions are pruned,
    // but the floor stays at or below the cursor, so nothing was missed.
    Carbon::setTestNow(Carbon::now()->addDays(100));
    $this->artisan('sync:prune')->assertSuccessful();
    Carbon::setTestNow();

    expect(Xid8::of((string) floorOf($this->company->id))->lessThan(Xid8::of((string) $cursor['txid'])->next()))->toBeTrue()
        ->and(pullPage($this, $cursor)['reset'])->toBeFalse();
});

it('removes expired push results and their resolutions', function (): void {
    DB::table('idempotency_keys')->insert([
        'id' => (string) Str::uuid7(), 'scope_hash' => str_repeat('a', 64), 'key' => (string) Str::uuid7(),
        'user_id' => $this->user->id, 'company_id' => $this->company->id, 'method' => 'POST', 'path' => '/api/v1/sync/push',
        'request_hash' => str_repeat('b', 64), 'status' => 'completed', 'response_status' => 200, 'response_headers' => '{}', 'response_body' => '{}',
        'expires_at' => Carbon::now()->subDay(), 'created_at' => Carbon::now()->subDays(8), 'updated_at' => Carbon::now()->subDays(8),
    ]);
    DB::table('sync_push_resolutions')->insert([
        'resolved_scope_hash' => str_repeat('c', 64), 'resolved_key' => (string) Str::uuid7(), 'superseded_by' => (string) Str::uuid7(),
        'user_id' => $this->user->id, 'company_id' => $this->company->id, 'created_at' => Carbon::now()->subDays(8),
    ]);

    $this->artisan('sync:prune')->assertSuccessful();

    expect(DB::table('idempotency_keys')->where('scope_hash', str_repeat('a', 64))->exists())->toBeFalse()
        ->and(DB::table('sync_push_resolutions')->count())->toBe(0);
});

it('pages a full download below the floor without resetting again', function (): void {
    // A real incremental cursor issued before any of the rows below the floor.
    SyncKit::waitVisible();
    $expired = pullPage($this, null)['next_cursor'];
    $notes = [];

    for ($i = 0; $i < 4; $i++) {
        $notes[] = SyncKit::note($this->company, ['title' => "N{$i}"]);
    }

    deleteNote($this, 'Pruned', 100);
    $this->artisan('sync:prune')->assertSuccessful();
    $floor = Xid8::of((string) floorOf($this->company->id));
    expect(Xid8::of((string) Sync::txidOf('sync_fixture_notes', $notes[3]->id))->lessThan($floor))->toBeTrue();
    SyncKit::waitVisible();

    $page = fn (?array $cursor): array => SyncKit::wire(SyncKit::pull($this, [['resource' => 'fixture-notes', 'cursor' => $cursor, 'limit' => 1]], $this->headers)->assertOk(), 'sync/pull.response.schema.json')['data']['resources'][0];

    // Starting from an expired incremental cursor: one reset, then plain continuation pages.
    $current = $page($expired);
    expect($current['reset_reason'])->toBe('cursor_expired');
    $seen = array_column($current['rows'], 'id');
    $pages = 1;

    while ($current['has_more'] && $pages < 10) {
        $current = $page($current['next_cursor']);
        expect($current['reset'])->toBeFalse();
        $seen = [...$seen, ...array_column($current['rows'], 'id')];
        $pages++;
    }

    expect($seen)->toBe(array_map(fn (FixtureNote $n): string => $n->id, $notes))
        ->and($pages)->toBe(4)
        ->and($current['has_more'])->toBeFalse()
        ->and($current['next_cursor']['after_id'])->toBeNull();

    // The same position held as a tagged incremental cursor (another device) is still expired.
    $other = SyncKit::headers($this->user, $this->company);
    $position = ['txid' => (string) Sync::txidOf('sync_fixture_notes', $notes[0]->id), 'after_id' => $notes[0]->id, 'gen' => 0];
    $cursor = [...$position, 'session' => app(CursorTags::class)->issue($this->user->id, $this->company->id, 'fixture-notes', Cursor::fromWire($position))];
    $incremental = SyncKit::wire(SyncKit::pull($this, [['resource' => 'fixture-notes', 'cursor' => $cursor]], $other)->assertOk(), 'sync/pull.response.schema.json')['data']['resources'][0];
    expect($incremental['reset_reason'])->toBe('cursor_expired');
});

it('reads floor and tombstones from one snapshot when a prune commits during the pull', function (): void {
    $gone = SyncKit::note($this->company, ['title' => 'Gone']);
    SyncKit::waitVisible();
    $cursor = pullPage($this, null)['next_cursor'];
    app(CompanyContext::class)->runAs($this->company->id, fn () => FixtureNote::query()->findOrFail($gone->id)->delete());
    DB::table('sync_tombstones')->where('row_id', $gone->id)->update(['deleted_at' => Carbon::now()->subDays(100)]);
    SyncKit::waitVisible();

    config(['database.connections.sync_race' => config('database.connections.'.config('database.default'))]);
    $race = DB::connection('sync_race');
    $fired = false;
    $company = $this->company->id;

    // Right after the pull read the floor, a prune commits on another connection.
    DB::listen(function ($query) use (&$fired, $race, $company): void {
        if ($fired || $query->connectionName === 'sync_race' || ! str_contains($query->sql, 'sync_watermarks')) {
            return;
        }

        $fired = true;
        $race->transaction(function () use ($race, $company): void {
            $top = $race->selectOne("DELETE FROM sync_tombstones WHERE resource_table = 'sync_fixture_notes' RETURNING sync_txid::text AS t");
            $race->statement(
                'INSERT INTO sync_watermarks (resource_table, company_id, floor_txid, pruned_at) VALUES (?, ?, ?::xid8, now())
                 ON CONFLICT (resource_table, company_id) DO UPDATE SET floor_txid = EXCLUDED.floor_txid',
                ['sync_fixture_notes', $company, Xid8::of($top->t)->next()->value],
            );
        });
    });

    $page = pullPage($this, $cursor);

    expect($fired)->toBeTrue()
        ->and($page['reset'])->toBeFalse()
        ->and(array_column($page['tombstones'], 'id'))->toBe([$gone->id])
        ->and(Sync::tombstone('sync_fixture_notes', $gone->id))->toBeNull();

    // A pull starting after the prune sees the raised floor instead.
    expect(pullPage($this, $cursor)['reset_reason'])->toBe('cursor_expired');
    $race->disconnect();
});
