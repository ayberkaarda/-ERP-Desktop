<?php

declare(strict_types=1);

use App\Modules\Identity\Services\DeviceTokens;
use App\Modules\Sync\Http\Middleware\LimitConcurrentPulls;
use App\Modules\Sync\Http\Middleware\PullLease;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Response;
use Tests\Feature\Sync\Support\SyncKit;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Identity;
use Tests\Support\Sync;

/*
 * /sync/* is rate limited per device (user_devices.id, kept across token refreshes) and per user
 * (TOO_MANY_ATTEMPTS, 429 with Retry-After), and a device runs at most
 * `concurrent_pulls_per_device` pulls at once; a pull never outlives its slot.
 */
uses(SyncDatabase::class);

beforeEach(function (): void {
    SyncKit::boot();
    [$this->company, $this->user] = SyncKit::actor(['fixtures.view']);
    $this->headers = SyncKit::headers($this->user, $this->company);
});

/**
 * @param  TestResponse<Response>  $response
 */
function assertThrottled(TestResponse $response): void
{
    $response->assertStatus(429)->assertHeader('Retry-After');
    expect(SyncKit::wire($response, 'sync/error.response.schema.json')['errors']['code'])->toBe('TOO_MANY_ATTEMPTS');
}

function throttledPull(object $test, array $headers): TestResponse
{
    return SyncKit::pull($test, [['resource' => 'fixture-notes', 'cursor' => null]], $headers);
}

it('limits the requests of one device', function (): void {
    config(['sync.throttle.device_per_minute' => 2, 'sync.throttle.user_per_minute' => 100]);

    SyncKit::manifestOf($this, $this->headers)->assertOk();
    throttledPull($this, $this->headers)->assertOk();
    assertThrottled(SyncKit::manifestOf($this, $this->headers));

    // Another device of the same user has its own budget.
    SyncKit::manifestOf($this, Sync::deviceHeaders($this->user, $this->company, 'fp-sync-desktop-0002'))->assertOk();
});

it('limits the requests of one user across devices', function (): void {
    config(['sync.throttle.device_per_minute' => 100, 'sync.throttle.user_per_minute' => 3]);
    $second = Sync::deviceHeaders($this->user, $this->company, 'fp-sync-desktop-0002');

    SyncKit::manifestOf($this, $this->headers)->assertOk();
    SyncKit::manifestOf($this, $second)->assertOk();
    throttledPull($this, $second)->assertOk();
    assertThrottled(SyncKit::manifestOf($this, $this->headers));

    // Another user is not affected.
    [$otherCompany, $other] = SyncKit::actor(['fixtures.view']);
    SyncKit::manifestOf($this, SyncKit::headers($other, $otherCompany))->assertOk();
});

it('refuses a pull while the device already runs as many as allowed', function (): void {
    $token = (string) Str::of($this->headers['Authorization'])->after('Bearer ')->before('|');
    $device = (string) DB::table('user_devices')->where('token_id', $token)->value('id');
    $lock = Cache::lock(LimitConcurrentPulls::key('device', $device, 0), 60);
    expect($lock->get())->toBeTrue();

    assertThrottled(throttledPull($this, $this->headers));
    // Manifest and push are not pulls.
    SyncKit::manifestOf($this, $this->headers)->assertOk();

    $lock->release();
    throttledPull($this, $this->headers)->assertOk();
});

it('refuses a pull while the user already runs as many as allowed on other devices', function (): void {
    config(['sync.throttle.concurrent_pulls_per_user' => 1]);
    $lock = Cache::lock(LimitConcurrentPulls::key('user', $this->user->id, 0), 60);
    expect($lock->get())->toBeTrue();

    assertThrottled(throttledPull($this, Sync::deviceHeaders($this->user, $this->company, 'fp-sync-desktop-0002')));

    $lock->release();
    throttledPull($this, $this->headers)->assertOk();
});

it('keeps the device budget and the pull slot across a token refresh', function (): void {
    config(['sync.throttle.device_per_minute' => 2, 'sync.throttle.user_per_minute' => 100]);
    $tokens = app(DeviceTokens::class);
    $issued = $tokens->issue($this->user, Request::create('/'), 'Refreshing device', 'fp-sync-desktop-0003');
    $headers = fn (string $token): array => ['Accept' => 'application/json', 'Authorization' => 'Bearer '.$token, 'X-Company-Id' => $this->company->id];
    Identity::fresh();

    SyncKit::manifestOf($this, $headers($issued['token']))->assertOk();
    SyncKit::manifestOf($this, $headers($issued['token']))->assertOk();
    $refreshed = $tokens->refresh($issued['refresh_token'], '127.0.0.1');
    Identity::fresh();

    // Same device, new access token: the budget is the device's, not the token's.
    assertThrottled(SyncKit::manifestOf($this, $headers($refreshed['token'])));

    config(['sync.throttle.device_per_minute' => 100]);
    $device = (string) DB::table('user_devices')->where('fingerprint_hash', hash('sha256', 'fp-sync-desktop-0003'))->value('id');
    $lock = Cache::lock(LimitConcurrentPulls::key('device', $device, 0), 60);
    expect($lock->get())->toBeTrue();

    // A pull still running under the old token holds the device's slot for the new one too.
    assertThrottled(throttledPull($this, $headers($refreshed['token'])));
    $lock->release();
});

it('bounds a running pull by its slot lease in the database', function (): void {
    config(['sync.throttle.pull_slot_seconds' => 30]);
    $seen = null;
    DB::listen(function ($query) use (&$seen): void {
        if ($seen === null && str_contains($query->sql, 'REPEATABLE READ')) {
            $seen = 'pending';
            $seen = [DB::selectOne('show transaction_timeout')->transaction_timeout, DB::selectOne('show statement_timeout')->statement_timeout];
        }
    });

    throttledPull($this, $this->headers)->assertOk();

    // Inside the pull: the database ends it before the 30 s slot could be taken again.
    expect($seen)->toBe(['25s', '25s'])
        ->and(DB::selectOne('show transaction_timeout')->transaction_timeout)->toBe('0')
        ->and(DB::selectOne('show statement_timeout')->statement_timeout)->toBe('0');
});

/**
 * Runs $slow once, on the pull's first visibility query, then lets the pull go on.
 */
function slowPullOnce(Closure $slow): void
{
    $done = false;
    DB::listen(function ($query) use (&$done, $slow): void {
        if (! $done && str_contains($query->sql, 'sync_visibility_generations')) {
            $done = true;
            $slow();
        }
    });
}

it('ends a pull whose work outside one statement outlasts the lease', function (): void {
    // 6 s slot - 5 s margin: a 1 s lease for the whole request.
    config(['sync.throttle.pull_slot_seconds' => 6]);
    slowPullOnce(fn () => usleep(1_200_000));

    $response = throttledPull($this, $this->headers);

    $response->assertStatus(500)->assertHeader('Retry-After');
    expect(SyncKit::wire($response, 'sync/error.response.schema.json')['errors']['code'])->toBe('SERVER_ERROR');
    // The slot is free again and the next pull runs.
    throttledPull($this, $this->headers)->assertOk();
});

it('cuts a statement at the deadline left, not at the full lease', function (): void {
    config(['sync.throttle.pull_slot_seconds' => 6]);
    $started = microtime(true);
    // 0.6 s gone, then a 0.7 s statement: within a fresh 1 s timeout, past the 1 s deadline.
    slowPullOnce(function (): void {
        usleep(600_000);
        DB::select('select pg_sleep(0.7)');
    });

    throttledPull($this, $this->headers)->assertStatus(500);

    expect(microtime(true) - $started)->toBeLessThan(1.25);
});

it('drops the connection when it cannot put the settings back', function (): void {
    $db = DB::connection();
    $db->beginTransaction();
    $lease = PullLease::begin($db, 30_000);

    // An aborted transaction refuses the restoring statements.
    try {
        $db->select('select 1/0');
    } catch (QueryException) {
    }
    $lease->end();

    expect($db->getRawPdo())->toBeNull()
        ->and(DB::selectOne('show statement_timeout')->statement_timeout)->toBe('0')
        ->and(DB::selectOne('show transaction_timeout')->transaction_timeout)->toBe('0');
});

it('restores the session settings the pull found', function (): void {
    DB::statement("SET statement_timeout = '7s'");

    throttledPull($this, $this->headers)->assertOk();

    expect(DB::selectOne('show statement_timeout')->statement_timeout)->toBe('7s')
        ->and(DB::selectOne('show transaction_timeout')->transaction_timeout)->toBe('0');
    DB::statement('RESET statement_timeout');
});

it('frees the pull slot after every pull, failed ones too', function (): void {
    config(['sync.throttle.device_per_minute' => 100, 'sync.throttle.user_per_minute' => 100]);

    throttledPull($this, $this->headers)->assertOk();
    SyncKit::pull($this, [['resource' => 'nope', 'cursor' => null]], $this->headers)->assertStatus(422);
    throttledPull($this, $this->headers)->assertOk();
});
