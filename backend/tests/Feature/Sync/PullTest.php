<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Core\Sync\Xid8;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Sync\Support\DatedNote;
use Tests\Feature\Sync\Support\GlobalTag;
use Tests\Feature\Sync\Support\SharedRate;
use Tests\Feature\Sync\Support\SyncKit;
use Tests\Fixtures\Sync\FixtureNote;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Actors;
use Tests\Support\Sync;

/*
 * Committed writes (SyncDatabase): pull only sees transactions below the horizon.
 */
uses(SyncDatabase::class);

beforeEach(function (): void {
    SyncKit::boot();
    [$this->company, $this->user] = SyncKit::actor(['fixtures.view']);
    $this->headers = SyncKit::headers($this->user, $this->company);
});

/**
 * @param  array<string, mixed>|null  $cursor
 * @return array<string, mixed>
 */
function pullNotes(object $test, ?array $cursor, ?int $limit = null, string $resource = 'fixture-notes'): array
{
    $entry = ['resource' => $resource, 'cursor' => $cursor];

    if ($limit !== null) {
        $entry['limit'] = $limit;
    }

    $response = SyncKit::pull($test, [$entry], $test->headers)->assertOk();

    return SyncKit::wire($response, 'sync/pull.response.schema.json')['data'];
}

/**
 * @param  array<string, mixed>  $body
 */
function pullError(object $test, array $body, int $status): string
{
    $response = SyncKit::post($test, 'pull', $body, $test->headers)->assertStatus($status);

    return SyncKit::wire($response, 'sync/error.response.schema.json')['errors']['code'];
}

it('downloads committed rows in pages with their embeds and ends at the horizon', function (): void {
    $notes = [];

    foreach (['A', 'B', 'C'] as $title) {
        $notes[] = SyncKit::note($this->company, ['title' => $title], ["{$title} line"]);
    }

    [$otherCompany] = SyncKit::actor();
    SyncKit::note($otherCompany, ['title' => 'Other company']);
    SyncKit::waitVisible();

    $first = pullNotes($this, null, 2);
    $page = $first['resources'][0];

    expect($page['has_more'])->toBeTrue()
        ->and($page['reset'])->toBeFalse()
        ->and(array_column($page['rows'], 'title'))->toBe(['A', 'B'])
        ->and($page['rows'][0]['lines'][0]['body'])->toBe('A line')
        ->and($page['next_cursor']['after_id'])->toBe($notes[1]->id)
        ->and($page['next_cursor']['txid'])->toBe((string) Sync::txidOf('sync_fixture_notes', $notes[1]->id))
        ->and($page['next_cursor']['gen'])->toBe(0);

    $second = pullNotes($this, $page['next_cursor'], 2)['resources'][0];

    expect(array_column($second['rows'], 'title'))->toBe(['C'])
        ->and($second['has_more'])->toBeFalse()
        ->and($second['next_cursor']['after_id'])->toBeNull();

    $horizon = Xid8::of($second['next_cursor']['txid']);
    expect($horizon->greaterThan(Sync::txidOf('sync_fixture_notes', $notes[2]->id)))->toBeTrue();

    // Nothing changed: the next incremental pull is empty.
    $third = pullNotes($this, $second['next_cursor'])['resources'][0];
    expect($third['rows'])->toBe([])->and($third['tombstones'])->toBe([]);

    // A line change moves its note back into the stream.
    app(CompanyContext::class)->runAs($this->company->id, fn () => $notes[0]->lines()->first()?->update(['body' => 'changed']));
    SyncKit::waitVisible();
    $fourth = pullNotes($this, $second['next_cursor'])['resources'][0];
    expect(array_column($fourth['rows'], 'id'))->toBe([$notes[0]->id])
        ->and($fourth['rows'][0]['lines'][0]['body'])->toBe('changed');
});

it('delivers soft and hard deletes as tombstones and restores as rows, each id once', function (): void {
    $soft = SyncKit::note($this->company, ['title' => 'Soft']);
    $hard = SyncKit::note($this->company, ['title' => 'Hard']);
    $kept = SyncKit::note($this->company, ['title' => 'Kept']);
    SyncKit::waitVisible();
    $cursor = pullNotes($this, null)['resources'][0]['next_cursor'];

    app(CompanyContext::class)->runAs($this->company->id, function () use ($soft, $hard): void {
        FixtureNote::query()->findOrFail($soft->id)->delete();
        FixtureNote::query()->findOrFail($hard->id)->forceDelete();
    });
    [$otherCompany] = SyncKit::actor();
    $foreign = SyncKit::note($otherCompany, ['title' => 'Foreign']);
    app(CompanyContext::class)->runAs($otherCompany->id, fn () => FixtureNote::query()->findOrFail($foreign->id)->delete());
    SyncKit::waitVisible();

    $page = pullNotes($this, $cursor)['resources'][0];

    expect($page['rows'])->toBe([])
        ->and(array_column($page['tombstones'], 'id'))->toBe([$soft->id, $hard->id])
        ->and(array_column($page['tombstones'], 'reason'))->toBe(['soft_deleted', 'deleted'])
        ->and($page['tombstones'][0]['sync_txid'])->toBe(Sync::tombstone('sync_fixture_notes', $soft->id)?->sync_txid);

    // Restore: the live row wins, the tombstone is gone, the id appears once.
    app(CompanyContext::class)->runAs($this->company->id, fn () => FixtureNote::withTrashed()->findOrFail($soft->id)->restore());
    SyncKit::waitVisible();
    $again = pullNotes($this, $cursor)['resources'][0];

    expect(array_column($again['rows'], 'id'))->toBe([$soft->id])
        ->and(array_column($again['tombstones'], 'id'))->toBe([$hard->id])
        ->and($kept->id)->not->toBeIn(array_column($again['rows'], 'id'));
});

it('keeps paging exact across rows and tombstones', function (): void {
    $notes = [];

    for ($i = 0; $i < 5; $i++) {
        $notes[] = SyncKit::note($this->company, ['title' => "N{$i}"]);
    }

    app(CompanyContext::class)->runAs($this->company->id, function () use ($notes): void {
        FixtureNote::query()->findOrFail($notes[1]->id)->delete();
        FixtureNote::query()->findOrFail($notes[3]->id)->delete();
    });
    SyncKit::waitVisible();

    $seen = [];
    $cursor = null;
    $pages = 0;

    do {
        $page = pullNotes($this, $cursor, 1)['resources'][0];
        $seen = [...$seen, ...array_column($page['rows'], 'id'), ...array_column($page['tombstones'], 'id')];
        expect(count($page['rows']) + count($page['tombstones']))->toBeLessThanOrEqual(1);
        $cursor = $page['next_cursor'];
        $pages++;
    } while ($page['has_more'] && $pages < 20);

    // Every id exactly once: live rows and the two tombstones, one event per page.
    expect($seen)->toHaveCount(5)
        ->and(array_unique($seen))->toHaveCount(5)
        ->and($pages)->toBeLessThan(20);
});

it('resets a cursor whose generation is behind and refuses one ahead', function (): void {
    SyncKit::note($this->company, ['title' => 'Visible']);
    SyncKit::waitVisible();
    $cursor = pullNotes($this, null)['resources'][0]['next_cursor'];

    Actors::revoke($this->user, $this->company->id);
    expect(pullError($this, ['schema_version' => 1, 'resources' => [['resource' => 'fixture-notes', 'cursor' => $cursor]]], 403))->toBe('FORBIDDEN');

    Actors::grant($this->user, $this->company->id, ['fixtures.view']);
    $page = pullNotes($this, $cursor)['resources'][0];

    expect($page['reset'])->toBeTrue()
        ->and($page['reset_reason'])->toBe('visibility_changed')
        ->and(array_column($page['rows'], 'title'))->toBe(['Visible'])
        ->and($page['next_cursor']['gen'])->toBe(2);

    // Another device still holding gen 0 gets the same reset; the generation is not consumed.
    expect(pullNotes($this, $cursor)['resources'][0]['reset_reason'])->toBe('visibility_changed');

    $ahead = [...$page['next_cursor'], 'gen' => 3];
    expect(pullError($this, ['schema_version' => 1, 'resources' => [['resource' => 'fixture-notes', 'cursor' => $ahead]]], 422))->toBe('SYNC_CURSOR_INVALID');
});

it('refuses malformed cursors and cursors beyond the horizon', function (array $cursor): void {
    expect(pullError($this, ['schema_version' => 1, 'resources' => [['resource' => 'fixture-notes', 'cursor' => $cursor]]], 422))->toBe('SYNC_CURSOR_INVALID');
})->with([
    'numeric txid' => [['txid' => 5, 'after_id' => null, 'gen' => 0]],
    'not a number' => [['txid' => 'abc', 'after_id' => null, 'gen' => 0]],
    'bad after_id' => [['txid' => '5', 'after_id' => 'not-a-uuid', 'gen' => 0]],
    'missing gen' => [['txid' => '5', 'after_id' => null]],
    'extra key' => [['txid' => '5', 'after_id' => null, 'gen' => 0, 'x' => 1]],
    'ahead of horizon' => [['txid' => '18446744073709551615', 'after_id' => null, 'gen' => 0]],
]);

it('answers request-level errors in the error envelope', function (): void {
    $notes = ['resource' => 'fixture-notes', 'cursor' => null];

    expect(pullError($this, ['schema_version' => 99, 'resources' => [$notes]], 409))->toBe('SYNC_SCHEMA_MISMATCH')
        ->and(pullError($this, ['schema_version' => 1, 'resources' => [['resource' => 'nope', 'cursor' => null]]], 422))->toBe('SYNC_RESOURCE_UNSUPPORTED')
        ->and(pullError($this, ['schema_version' => 1, 'resources' => [['resource' => 'fixture-unadapted', 'cursor' => null]]], 422))->toBe('SYNC_RESOURCE_UNSUPPORTED')
        ->and(pullError($this, ['schema_version' => 1, 'resources' => [['resource' => 'fixture-balances', 'cursor' => null]]], 422))->toBe('SYNC_RESOURCE_UNSUPPORTED')
        ->and(pullError($this, ['schema_version' => 1, 'resources' => [$notes, $notes]], 422))->toBe('VALIDATION_ERROR')
        ->and(pullError($this, ['schema_version' => 1, 'resources' => [['resource' => 'fixture-notes']]], 422))->toBe('VALIDATION_ERROR');

    config(['sync.limits.pull_resources_max' => 1]);
    expect(pullError($this, ['schema_version' => 1, 'resources' => [$notes, ['resource' => 'fixture-dated-notes', 'cursor' => null]]], 413))->toBe('SYNC_BATCH_TOO_LARGE');
});

it('serves several resources in request order', function (): void {
    SyncKit::note($this->company, ['title' => 'Note']);
    app(CompanyContext::class)->runAs($this->company->id, fn () => DatedNote::query()->create(['title' => 'Dated', 'note_date' => Carbon::today()->toDateString()]));
    SyncKit::waitVisible();

    $data = SyncKit::wire(SyncKit::pull($this, [
        ['resource' => 'fixture-dated-notes', 'cursor' => null],
        ['resource' => 'fixture-notes', 'cursor' => null, 'limit' => 5],
    ], $this->headers)->assertOk(), 'sync/pull.response.schema.json')['data'];

    expect(array_column($data['resources'], 'resource'))->toBe(['fixture-dated-notes', 'fixture-notes'])
        ->and($data['resources'][0]['rows'][0]['title'])->toBe('Dated')
        ->and($data['resources'][1]['rows'][0]['title'])->toBe('Note')
        ->and(Xid8::of($data['horizon'])->equals(Xid8::of($data['resources'][0]['next_cursor']['txid'])))->toBeTrue();
});

it('turns a changed row that left the window into an out_of_scope tombstone', function (): void {
    $create = fn (string $title, string $date): DatedNote => app(CompanyContext::class)->runAs(
        $this->company->id,
        fn (): DatedNote => DatedNote::query()->create(['title' => $title, 'note_date' => $date]),
    );
    $recent = $create('Recent', Carbon::today()->subDays(3)->toDateString());
    $create('Old', Carbon::today()->subDays(90)->toDateString());
    SyncKit::waitVisible();

    // First download: only rows inside the window, no tombstones for what the client never had.
    $first = pullNotes($this, null, null, 'fixture-dated-notes')['resources'][0];
    expect(array_column($first['rows'], 'title'))->toBe(['Recent'])->and($first['tombstones'])->toBe([]);

    // The recent note is moved out of the window: the client must drop it.
    app(CompanyContext::class)->runAs($this->company->id, fn () => DatedNote::query()->findOrFail($recent->id)->update(['note_date' => Carbon::today()->subDays(60)->toDateString()]));
    SyncKit::waitVisible();
    $next = pullNotes($this, $first['next_cursor'], null, 'fixture-dated-notes')['resources'][0];

    expect($next['rows'])->toBe([])
        ->and($next['tombstones'])->toHaveCount(1)
        ->and($next['tombstones'][0])->toMatchArray(['id' => $recent->id, 'reason' => 'out_of_scope', 'sync_txid' => (string) Sync::txidOf(DatedNote::TABLE, $recent->id)]);

    // Moved back into the window: a normal row event.
    app(CompanyContext::class)->runAs($this->company->id, fn () => DatedNote::query()->findOrFail($recent->id)->update(['note_date' => Carbon::today()->toDateString()]));
    SyncKit::waitVisible();
    $back = pullNotes($this, $next['next_cursor'], null, 'fixture-dated-notes')['resources'][0];
    expect(array_column($back['rows'], 'id'))->toBe([$recent->id])->and($back['tombstones'])->toBe([]);
    expect(DB::table(DatedNote::TABLE)->count())->toBe(2);
});

it('never lets another company\'s rows or tombstones through, for company, company_or_global and global resources', function (): void {
    [$otherCompany, $otherUser] = SyncKit::actor(['fixtures.view']);
    $otherHeaders = SyncKit::headers($otherUser, $otherCompany);
    $rate = fn (?string $company, string $name): SharedRate => SharedRate::query()->create(['company_id' => $company, 'name' => $name]);

    $ids = [];

    foreach (['mine' => $this->company, 'theirs' => $otherCompany] as $who => $company) {
        $ids["{$who}.note.live"] = SyncKit::note($company, ['title' => "{$who} live"])->id;
        $gone = SyncKit::note($company, ['title' => "{$who} gone"]);
        app(CompanyContext::class)->runAs($company->id, fn () => FixtureNote::query()->findOrFail($gone->id)->delete());
        $ids["{$who}.note.gone"] = $gone->id;

        $ids["{$who}.rate.live"] = $rate($company->id, "{$who} rate")->id;
        $goneRate = $rate($company->id, "{$who} old rate");
        $goneRate->delete();
        $ids["{$who}.rate.gone"] = $goneRate->id;
    }

    $ids['system.rate.live'] = $rate(null, 'TCMB')->id;
    $systemGone = $rate(null, 'TCMB old');
    $systemGone->delete();
    $ids['system.rate.gone'] = $systemGone->id;
    $ids['tag.live'] = GlobalTag::query()->create(['name' => 'live'])->id;
    $tagGone = GlobalTag::query()->create(['name' => 'gone']);
    $tagGone->delete();
    $ids['tag.gone'] = $tagGone->id;
    SyncKit::waitVisible();

    $read = function (array $headers): array {
        $data = SyncKit::wire(SyncKit::pull($this, [
            ['resource' => 'fixture-notes', 'cursor' => null],
            ['resource' => 'fixture-rates', 'cursor' => null],
            ['resource' => 'fixture-tags', 'cursor' => null],
        ], $headers)->assertOk(), 'sync/pull.response.schema.json')['data']['resources'];

        return array_map(static fn (array $page): array => [
            'rows' => collect($page['rows'])->pluck('id')->sort()->values()->all(),
            'tombstones' => collect($page['tombstones'])->pluck('id')->sort()->values()->all(),
        ], $data);
    };
    $sorted = static fn (string ...$keys): array => collect($keys)->map(fn (string $k): string => $ids[$k])->sort()->values()->all();

    foreach (['mine' => $this->headers, 'theirs' => $otherHeaders] as $who => $headers) {
        [$notes, $rates, $tags] = $read($headers);

        expect($notes)->toBe(['rows' => $sorted("{$who}.note.live"), 'tombstones' => $sorted("{$who}.note.gone")])
            ->and($rates)->toBe(['rows' => $sorted("{$who}.rate.live", 'system.rate.live'), 'tombstones' => $sorted("{$who}.rate.gone", 'system.rate.gone')])
            ->and($tags)->toBe(['rows' => $sorted('tag.live'), 'tombstones' => $sorted('tag.gone')]);
    }
});
