<?php

declare(strict_types=1);

use App\Modules\Sync\Http\Middleware\LimitConcurrentPulls;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Response;
use Tests\Feature\Sync\Support\SyncKit;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Identity;

/*
 * The sync request budget and the pull slot belong to the device (user_devices.id). A new
 * POST /auth/device with the same fingerprint is the same device: it gets neither a fresh
 * budget nor a free pull slot.
 */
uses(SyncDatabase::class);

beforeEach(function (): void {
    SyncKit::boot();
    [$this->company, $this->user] = SyncKit::actor(['fixtures.view']);
});

/** @return array{token: string, device: string} */
function reloginDevice(object $test, string $fingerprint): array
{
    Identity::fresh();
    $token = (string) $test->postJson('/api/v1/auth/device', [
        'email' => $test->user->email,
        'password' => Identity::PASSWORD,
        'device_name' => 'Kasa PC',
        'fingerprint' => $fingerprint,
    ])->assertOk()->json('data.token');

    return [
        'token' => $token,
        'device' => (string) DB::table('user_devices')->where('token_id', (string) strstr($token, '|', true))->value('id'),
    ];
}

/** @return array<string, string> */
function reloginHeaders(object $test, string $token): array
{
    return ['Accept' => 'application/json', 'Authorization' => 'Bearer '.$token, 'X-Company-Id' => $test->company->id];
}

/** @param  TestResponse<Response>  $response */
function reloginThrottled(TestResponse $response): void
{
    $response->assertStatus(429)->assertHeader('Retry-After');
    expect($response->json('errors.code'))->toBe('TOO_MANY_ATTEMPTS');
}

it('keeps the device request budget across a new login with the same fingerprint', function (): void {
    config(['sync.throttle.device_per_minute' => 2, 'sync.throttle.user_per_minute' => 100]);
    $first = reloginDevice($this, 'fp-relogin-budget-01');

    SyncKit::manifestOf($this, reloginHeaders($this, $first['token']))->assertOk();
    SyncKit::manifestOf($this, reloginHeaders($this, $first['token']))->assertOk();
    reloginThrottled(SyncKit::manifestOf($this, reloginHeaders($this, $first['token'])));

    $again = reloginDevice($this, 'fp-relogin-budget-01');

    expect($again['device'])->toBe($first['device']);
    reloginThrottled(SyncKit::manifestOf($this, reloginHeaders($this, $again['token'])));
});

it('keeps the running pull slot of a device across a new login with the same fingerprint', function (): void {
    $first = reloginDevice($this, 'fp-relogin-slot-02');
    $lock = Cache::lock(LimitConcurrentPulls::key('device', $first['device'], 0), 60);
    expect($lock->get())->toBeTrue();

    try {
        reloginThrottled(SyncKit::pull($this, [['resource' => 'fixture-notes', 'cursor' => null]], reloginHeaders($this, $first['token'])));

        $again = reloginDevice($this, 'fp-relogin-slot-02');

        reloginThrottled(SyncKit::pull($this, [['resource' => 'fixture-notes', 'cursor' => null]], reloginHeaders($this, $again['token'])));
    } finally {
        $lock->release();
    }
});
