<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Core\Sync\Xid8;
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
    $old = deleteNote($this, 'Old', 100);
    $young = deleteNote($this, 'Young', 10);
    $oldTxid = Xid8::of((string) Sync::tombstone('sync_fixture_notes', $old->id)?->sync_txid);
    SyncKit::waitVisible();

    $this->artisan('sync:prune')->assertSuccessful();

    expect(Sync::tombstone('sync_fixture_notes', $old->id))->toBeNull()
        ->and(Sync::tombstone('sync_fixture_notes', $young->id))->not->toBeNull()
        ->and(floorOf($this->company->id))->toBe($oldTxid->next()->value);

    // A cursor sitting exactly on the pruned delete (with or without after_id) has missed it.
    foreach ([['txid' => $oldTxid->value, 'after_id' => null, 'gen' => 0], ['txid' => $oldTxid->value, 'after_id' => $old->id, 'gen' => 0]] as $cursor) {
        $page = pullPage($this, $cursor);
        expect($page['reset'])->toBeTrue()
            ->and($page['reset_reason'])->toBe('cursor_expired')
            ->and(array_column($page['tombstones'], 'id'))->toBe([$young->id]);
    }

    // At the floor nothing was missed; a first download is never expired.
    expect(pullPage($this, ['txid' => $oldTxid->next()->value, 'after_id' => null, 'gen' => 0])['reset'])->toBeFalse()
        ->and(pullPage($this, null)['reset'])->toBeFalse();
});

it('only raises the floor and leaves other companies alone', function (): void {
    $first = deleteNote($this, 'First', 100);
    $this->artisan('sync:prune')->assertSuccessful();
    $floor = floorOf($this->company->id);

    // A tombstone with a smaller sync_txid pruned later cannot lower the floor.
    $second = deleteNote($this, 'Second', 100);
    DB::statement("UPDATE sync_tombstones SET sync_txid = '1'::xid8 WHERE row_id = ?", [$second->id]);
    $this->artisan('sync:prune')->assertSuccessful();

    expect(floorOf($this->company->id))->toBe($floor)
        ->and(DB::table('sync_watermarks')->count())->toBe(1)
        ->and(Sync::tombstone('sync_fixture_notes', $first->id))->toBeNull();

    [$other, $otherUser] = SyncKit::actor(['fixtures.view']);
    $headers = SyncKit::headers($otherUser, $other);
    $page = SyncKit::wire(SyncKit::pull($this, [['resource' => 'fixture-notes', 'cursor' => ['txid' => '1', 'after_id' => null, 'gen' => 0]]], $headers)->assertOk(), 'sync/pull.response.schema.json')['data']['resources'][0];
    expect($page['reset'])->toBeFalse();
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
