<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Modules\Identity\Models\UserDevice;
use App\Modules\Identity\Services\DeviceTokens;
use App\Modules\Sync\Services\PushResults;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Feature\Sync\Support\SyncKit;
use Tests\Fixtures\Sync\FixtureNote;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Identity;

/*
 * Continuation of full downloads (App\Modules\Sync\Services\FullDownloads): bound to the device,
 * one session per device, company and resource, cleaned up when done or revoked.
 */
uses(SyncDatabase::class);

beforeEach(function (): void {
    SyncKit::boot();
    [$this->company, $this->user] = SyncKit::actor(['fixtures.view']);
    $this->issued = app(DeviceTokens::class)->issue($this->user, Request::create('/'), 'Download device', 'fp-download');
    Identity::fresh();
    $this->headers = fn (string $token): array => ['Accept' => 'application/json', 'Authorization' => 'Bearer '.$token, 'X-Company-Id' => $this->company->id];

    $this->notes = [];

    for ($i = 0; $i < 3; $i++) {
        $this->notes[] = SyncKit::note($this->company, ['title' => "N{$i}"]);
    }
});

/**
 * Raises the tombstone floor above every row created so far.
 */
function raiseFloor(object $test): void
{
    $gone = SyncKit::note($test->company, ['title' => 'Pruned']);
    app(CompanyContext::class)->runAs($test->company->id, fn () => FixtureNote::query()->findOrFail($gone->id)->delete());
    DB::table('sync_tombstones')->where('row_id', $gone->id)->update(['deleted_at' => Carbon::now()->subDays(100)]);
    $test->artisan('sync:prune')->assertSuccessful();
    SyncKit::waitVisible();
}

/**
 * @param  array<string, mixed>|null  $cursor
 * @return array<string, mixed>
 */
function downloadPage(object $test, string $token, ?array $cursor): array
{
    $response = SyncKit::pull($test, [['resource' => 'fixture-notes', 'cursor' => $cursor, 'limit' => 1]], ($test->headers)($token))->assertOk();

    return SyncKit::wire($response, 'sync/pull.response.schema.json')['data']['resources'][0];
}

function sessions(object $test): int
{
    return DB::table('sync_full_downloads')->where('company_id', $test->company->id)->count();
}

it('keeps a full download going across an access token refresh', function (): void {
    raiseFloor($this);
    $first = downloadPage($this, $this->issued['token'], null);
    expect($first['has_more'])->toBeTrue();

    $rotated = app(DeviceTokens::class)->refresh($this->issued['refresh_token'], '127.0.0.1');
    Identity::fresh();
    $second = downloadPage($this, $rotated['token'], $first['next_cursor']);

    expect($second['reset'])->toBeFalse()
        ->and(array_column($second['rows'], 'id'))->toBe([$this->notes[1]->id]);
});

it('starts a new session when a reset issues the same first cursor again', function (): void {
    SyncKit::waitVisible();
    $first = downloadPage($this, $this->issued['token'], null);

    // The download is now older than the floor: its continuation resets, and the new download
    // begins with the same first row, so the same cursor.
    raiseFloor($this);
    $reset = downloadPage($this, $this->issued['token'], $first['next_cursor']);
    expect($reset['reset_reason'])->toBe('cursor_expired')
        ->and(array_diff_key($reset['next_cursor'], ['session' => 0]))->toBe(array_diff_key($first['next_cursor'], ['session' => 0]))
        ->and($reset['next_cursor']['session'])->not->toBe($first['next_cursor']['session']);

    $next = downloadPage($this, $this->issued['token'], $reset['next_cursor']);
    expect($next['reset'])->toBeFalse()
        ->and(array_column($next['rows'], 'id'))->toBe([$this->notes[1]->id]);
});

it('keeps one session per device, company and resource and drops it when done', function (): void {
    raiseFloor($this);
    $token = $this->issued['token'];

    // Voluntary restarts at different depths.
    $page = downloadPage($this, $token, null);
    downloadPage($this, $token, $page['next_cursor']);
    $page = downloadPage($this, $token, null);
    expect(sessions($this))->toBe(1);

    while ($page['has_more']) {
        $page = downloadPage($this, $token, $page['next_cursor']);
        expect($page['reset'])->toBeFalse();
    }

    expect(sessions($this))->toBe(0);
});

it('drops the sessions of a revoked device', function (): void {
    SyncKit::waitVisible();
    downloadPage($this, $this->issued['token'], null);
    expect(sessions($this))->toBe(1);

    app(DeviceTokens::class)->revoke($this->user, UserDevice::query()->where('user_id', $this->user->id)->firstOrFail());

    expect(sessions($this))->toBe(0);
});

it('leaves a newer session alone when an older continuation finishes or moves on', function (int $limit): void {
    SyncKit::waitVisible();
    $token = $this->issued['token'];
    $first = downloadPage($this, $token, null);

    config(['database.connections.sync_session_race' => config('database.connections.'.config('database.default'))]);
    $race = DB::connection('sync_session_race');
    $fired = false;

    // Right after the old continuation read its session, the device starts a new download.
    DB::listen(function ($query) use (&$fired, $race): void {
        if ($fired || $query->connectionName === 'sync_session_race' || ! str_contains($query->sql, 'sync_full_downloads') || ! str_starts_with(strtolower(ltrim($query->sql)), 'select')) {
            return;
        }

        $fired = true;
        $race->statement("UPDATE sync_full_downloads SET session_id = uuidv7(), version = 1, started_horizon = '7'::xid8, cursor_hash = ?, previous_hash = NULL", [str_repeat('e', 64)]);
    });

    $response = SyncKit::pull($this, [['resource' => 'fixture-notes', 'cursor' => $first['next_cursor'], 'limit' => $limit]], ($this->headers)($token))->assertOk();
    $race->disconnect();
    $page = SyncKit::wire($response, 'sync/pull.response.schema.json')['data']['resources'][0];

    $row = DB::table('sync_full_downloads')->where('company_id', $this->company->id)->selectRaw('cursor_hash, started_horizon::text AS started')->first();

    expect($fired)->toBeTrue()
        ->and($page['has_more'])->toBe($limit === 1)
        ->and($row)->not->toBeNull()
        ->and($row?->cursor_hash)->toBe(str_repeat('e', 64))
        ->and($row?->started)->toBe('7');
})->with([
    'completion would delete it' => [10],
    'continuation would overwrite it' => [1],
]);

it('hashes payloads the same whatever the number serialization', function (): void {
    expect(PushResults::payloadHash(['qty' => 1, 'lines' => [['price' => 2.0]]]))
        ->toBe(PushResults::payloadHash(['lines' => [['price' => 2]], 'qty' => 1.0]))
        ->and(PushResults::payloadHash(['qty' => 1.5]))->not->toBe(PushResults::payloadHash(['qty' => 1]))
        ->and(PushResults::payloadHash(['qty' => '1.0']))->not->toBe(PushResults::payloadHash(['qty' => 1]));
});

it('does not continue a cursor of an older session once a new download started', function (): void {
    raiseFloor($this);
    $token = $this->issued['token'];
    $first = downloadPage($this, $token, null);
    $second = downloadPage($this, $token, $first['next_cursor']);
    expect($second['reset'])->toBeFalse();

    // The device starts over; the old session's cursors no longer continue anything.
    downloadPage($this, $token, null);
    $old = downloadPage($this, $token, $second['next_cursor']);

    expect($old['reset'])->toBeTrue()
        ->and($old['reset_reason'])->toBe('cursor_expired');
});

/**
 * @param  array<string, mixed>|null  $cursor
 * @return array<string, mixed>
 */
function sessionPage(object $test, ?array $cursor, int $limit): array
{
    $response = SyncKit::pull($test, [['resource' => 'fixture-notes', 'cursor' => $cursor, 'limit' => $limit]], ($test->headers)($test->issued['token']))->assertOk();

    return SyncKit::wire($response, 'sync/pull.response.schema.json')['data']['resources'][0];
}

function sessionRow(object $test): ?object
{
    return DB::table('sync_full_downloads')->where('company_id', $test->company->id)->selectRaw('session_id::text AS session_id, cursor_hash, started_horizon::text AS started')->first();
}

/**
 * Runs $race on a second connection right after the first query on $table of the next request.
 */
function raceAfter(string $table, Closure $race): Closure
{
    config(['database.connections.sync_race_session' => config('database.connections.'.config('database.default'))]);
    $connection = DB::connection('sync_race_session');
    $state = (object) ['fired' => false];

    DB::listen(function ($query) use ($state, $connection, $table, $race): void {
        if ($state->fired || $query->connectionName === 'sync_race_session' || ! str_contains($query->sql, $table)) {
            return;
        }

        $state->fired = true;
        $race($connection);
    });

    return static function () use ($state, $connection): bool {
        $connection->disconnect();

        return $state->fired;
    };
}

it('tells an old session cursor from an equal cursor of a new session after a lost reset', function (): void {
    $extra = [SyncKit::note($this->company, ['title' => 'N3']), SyncKit::note($this->company, ['title' => 'N4'])];
    $all = [...$this->notes, ...$extra];
    SyncKit::waitVisible();

    $page1 = sessionPage($this, null, 2);
    $page2 = sessionPage($this, $page1['next_cursor'], 2);
    expect($page2['has_more'])->toBeTrue()
        ->and($page2['next_cursor']['session'])->toBeString()->toBe($page1['next_cursor']['session']);

    // The first two rows are deleted and their tombstones pruned past the download's start.
    app(CompanyContext::class)->runAs($this->company->id, function () use ($all): void {
        FixtureNote::query()->findOrFail($all[0]->id)->delete();
        FixtureNote::query()->findOrFail($all[1]->id)->delete();
    });
    DB::table('sync_tombstones')->whereIn('row_id', [$all[0]->id, $all[1]->id])->update(['deleted_at' => Carbon::now()->subDays(100)]);
    $this->artisan('sync:prune')->assertSuccessful();
    SyncKit::waitVisible();

    // The reset starts a new session whose first page ends on the same row.
    $reset = sessionPage($this, $page2['next_cursor'], 2);
    expect($reset['reset_reason'])->toBe('cursor_expired')
        ->and(array_diff_key($reset['next_cursor'], ['session' => 0]))->toBe(array_diff_key($page2['next_cursor'], ['session' => 0]))
        ->and($reset['next_cursor']['session'])->not->toBe($page2['next_cursor']['session']);

    // That response is lost: the retry with the old cursor must reset again, not continue.
    $retry = sessionPage($this, $page2['next_cursor'], 2);
    expect($retry['reset'])->toBeTrue()
        ->and($retry['reset_reason'])->toBe('cursor_expired');

    // The new session's own cursor continues.
    $continued = sessionPage($this, $retry['next_cursor'], 2);
    expect($continued['reset'])->toBeFalse()
        ->and(array_column($continued['rows'], 'id'))->toBe([$all[4]->id]);
});

it('marks incremental cursors with a null session and rejects malformed sessions', function (mixed $session): void {
    SyncKit::waitVisible();
    $done = sessionPage($this, null, 10);
    expect($done['has_more'])->toBeFalse()->and($done['next_cursor']['session'])->toBeNull();

    $response = SyncKit::pull($this, [['resource' => 'fixture-notes', 'cursor' => [...$done['next_cursor'], 'session' => $session], 'limit' => 1]], ($this->headers)($this->issued['token']));
    $missing = SyncKit::pull($this, [['resource' => 'fixture-notes', 'cursor' => array_diff_key($done['next_cursor'], ['session' => 0])]], ($this->headers)($this->issued['token']));

    expect($response->status())->toBe(422)
        ->and($response->json('errors.code'))->toBe('SYNC_CURSOR_INVALID')
        ->and($missing->json('errors.code'))->toBe('SYNC_CURSOR_INVALID');
})->with([
    'number' => [5],
    'spaces' => ['not a session'],
]);

it('answers a continuation with an unknown session by a reset', function (): void {
    raiseFloor($this);
    $first = sessionPage($this, null, 1);
    $forged = [...$first['next_cursor'], 'session' => (string) Str::uuid7()];

    expect(sessionPage($this, $forged, 1)['reset_reason'])->toBe('cursor_expired')
        ->and(sessionPage($this, $first['next_cursor'], 1)['reset'])->toBeTrue();
});

it('does not let a delayed first page replace or remove a newer session', function (int $limit): void {
    SyncKit::waitVisible();
    $newer = ['session_id' => (string) Str::uuid7(), 'cursor_hash' => str_repeat('f', 64)];
    $device = DB::table('user_devices')->where('user_id', $this->user->id)->value('id');

    // While the first page is read, another request of the device starts a session.
    $fired = raceAfter('sync_fixture_notes', function ($race) use ($newer, $device): void {
        $race->statement(
            "INSERT INTO sync_full_downloads (device_id, user_id, company_id, resource, session_id, cursor_hash, started_horizon, created_at, updated_at)
             VALUES (?, ?, ?, 'fixture-notes', ?::uuid, ?, '9'::xid8, now(), now())",
            [$device, $this->user->id, $this->company->id, $newer['session_id'], $newer['cursor_hash']],
        );
    });

    sessionPage($this, null, $limit);

    expect($fired())->toBeTrue()
        ->and(sessionRow($this))->toMatchArray([...$newer, 'started' => '9']);
})->with([
    'start would overwrite it' => [1],
    'forget would delete it' => [10],
]);

it('does not let a stale request move its own session backwards or swap a renewed session', function (): void {
    SyncKit::note($this->company, ['title' => 'N3']);
    raiseFloor($this);
    $first = sessionPage($this, null, 1);

    // A long page and then a delayed short page, both from the first cursor.
    $long = sessionPage($this, $first['next_cursor'], 2);
    $short = sessionPage($this, $first['next_cursor'], 1);
    expect($short['reset'])->toBeFalse();

    $after = sessionPage($this, $long['next_cursor'], 10);
    expect($after['reset'])->toBeFalse();

    // The session id changes under a continuation (a new download with the same cursor value).
    $renewed = sessionPage($this, null, 1);
    $replacement = (string) Str::uuid7();
    $fired = raceAfter('sync_fixture_notes', function ($race) use ($replacement): void {
        $race->update('UPDATE sync_full_downloads SET session_id = ?::uuid', [$replacement]);
    });
    sessionPage($this, $renewed['next_cursor'], 1);

    expect($fired())->toBeTrue()
        ->and(sessionRow($this)?->session_id)->toBe($replacement);
});

it('hashes large integral numbers by value', function (string $a, string $b): void {
    expect(PushResults::payloadHash(json_decode($a, true)))->toBe(PushResults::payloadHash(json_decode($b, true)));
})->with([
    '1e18' => ['{"q":1e18}', '{"q":1000000000000000000}'],
    '-4.0e15' => ['{"q":-4.0e15}', '{"q":-4000000000000000}'],
    '1e19 (beyond int64)' => ['{"q":1e19}', '{"q":10000000000000000000}'],
]);

it('does not end a session when a retry from the previous cursor reaches the end', function (): void {
    raiseFloor($this);
    $first = sessionPage($this, null, 1);

    // A gives the short page B; A is then retried with a larger limit and reaches the end.
    $short = sessionPage($this, $first['next_cursor'], 1);
    expect($short['has_more'])->toBeTrue();
    $retry = sessionPage($this, $first['next_cursor'], 10);
    expect($retry['has_more'])->toBeFalse()
        ->and(sessionRow($this))->not->toBeNull();

    // Continuing from B is still the same session.
    $after = sessionPage($this, $short['next_cursor'], 10);
    expect($after['reset'])->toBeFalse()
        ->and($after['has_more'])->toBeFalse()
        ->and(sessionRow($this))->toBeNull();
});
