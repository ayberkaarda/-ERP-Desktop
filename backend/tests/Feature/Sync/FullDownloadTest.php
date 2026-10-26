<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Modules\Identity\Models\UserDevice;
use App\Modules\Identity\Services\DeviceTokens;
use App\Modules\Sync\Services\PushResults;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
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
        ->and($reset['next_cursor'])->toBe($first['next_cursor']);

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
        $race->statement("UPDATE sync_full_downloads SET started_horizon = '7'::xid8, cursor_hash = ?, previous_hash = NULL", [str_repeat('e', 64)]);
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
