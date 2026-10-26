<?php

declare(strict_types=1);

use App\Modules\Sync\Http\Middleware\LimitConcurrentPulls;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Response;
use Tests\Feature\Sync\Support\SyncKit;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Sync;

/*
 * /sync/* is rate limited per device token and per user (TOO_MANY_ATTEMPTS, 429 with
 * Retry-After), and a device runs at most `concurrent_pulls_per_device` pulls at once.
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
    $lock = Cache::lock(LimitConcurrentPulls::key('device', $token, 0), 60);
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

it('frees the pull slot after every pull, failed ones too', function (): void {
    config(['sync.throttle.device_per_minute' => 100, 'sync.throttle.user_per_minute' => 100]);

    throttledPull($this, $this->headers)->assertOk();
    SyncKit::pull($this, [['resource' => 'nope', 'cursor' => null]], $this->headers)->assertStatus(422);
    throttledPull($this, $this->headers)->assertOk();
});
