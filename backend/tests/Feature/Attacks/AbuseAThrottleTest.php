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
 * Abuse group A / 1: sync rate limits and concurrent pull slots, attacked by the user's own
 * desktop client. Each test asserts the SAFE behaviour; a red test is the finding.
 *
 *  - ABA-RL-01/02: a fresh POST /auth/device with the same fingerprint must not give the device a
 *    new request budget or a free pull slot.
 *  - ABA-RL-03: the number of devices a user can register is bounded.
 *  - ABA-RL-04: the per-user budget holds however many devices (and re-logins) are used.
 *  - ABA-RL-05/06: real parallel pulls from separate processes never exceed the per-user and
 *    per-device slot limits.
 *  - ABA-RL-07: a token refresh does not reset the device budget or the refresh quota.
 */
uses(SyncDatabase::class);

beforeEach(function (): void {
    SyncKit::boot();
    [$this->company, $this->user] = SyncKit::actor(['fixtures.view']);
});

/**
 * Real device login as the desktop app does it.
 *
 * @return array{token: string, refresh_token: string, device: string}
 */
function abuseALogin(object $test, string $fingerprint): array
{
    Identity::fresh();
    $data = $test->postJson('/api/v1/auth/device', [
        'email' => $test->user->email,
        'password' => Identity::PASSWORD,
        'device_name' => 'Kasa PC',
        'fingerprint' => $fingerprint,
    ])->assertOk()->json('data');
    $token = (string) $data['token'];
    $tokenId = (string) strstr($token, '|', true);

    return [
        'token' => $token,
        'refresh_token' => (string) $data['refresh_token'],
        'device' => (string) DB::table('user_devices')->where('token_id', $tokenId)->value('id'),
    ];
}

/** @return array<string, string> */
function abuseAHeaders(object $test, string $token): array
{
    return ['Accept' => 'application/json', 'Authorization' => 'Bearer '.$token, 'X-Company-Id' => $test->company->id];
}

/**
 * @param  TestResponse<Response>  $response
 */
function abuseAThrottled(TestResponse $response): void
{
    $response->assertStatus(429)->assertHeader('Retry-After');
    expect($response->json('errors.code'))->toBe('TOO_MANY_ATTEMPTS');
}

/** @return TestResponse<Response> */
function abuseAPull(object $test, string $token): TestResponse
{
    return SyncKit::pull($test, [['resource' => 'fixture-notes', 'cursor' => null]], abuseAHeaders($test, $token));
}

it('ABA-RL-01 keeps the device request budget across a re-login with the same fingerprint', function (): void {
    config(['sync.throttle.device_per_minute' => 2, 'sync.throttle.user_per_minute' => 100]);
    $first = abuseALogin($this, 'fp-abuse-a-relogin-01');

    SyncKit::manifestOf($this, abuseAHeaders($this, $first['token']))->assertOk();
    SyncKit::manifestOf($this, abuseAHeaders($this, $first['token']))->assertOk();
    abuseAThrottled(SyncKit::manifestOf($this, abuseAHeaders($this, $first['token'])));

    // Same physical device, same fingerprint, a new login: the budget is the device's.
    $again = abuseALogin($this, 'fp-abuse-a-relogin-01');

    expect($again['device'])->toBe($first['device']); // a login keeps the device of its fingerprint
    abuseAThrottled(SyncKit::manifestOf($this, abuseAHeaders($this, $again['token'])));
});

it('ABA-RL-02 keeps the running pull slot of a device across a re-login with the same fingerprint', function (): void {
    $first = abuseALogin($this, 'fp-abuse-a-relogin-02');
    // A pull of this device is still running (its slot is held).
    $lock = Cache::lock(LimitConcurrentPulls::key('device', $first['device'], 0), 60);
    expect($lock->get())->toBeTrue();
    abuseAThrottled(abuseAPull($this, $first['token']));

    $again = abuseALogin($this, 'fp-abuse-a-relogin-02');

    try {
        // The same device must not run a second pull just because it logged in again.
        abuseAThrottled(abuseAPull($this, $again['token']));
    } finally {
        $lock->release();
    }
});

it('ABA-RL-03 bounds the number of devices one user can register', function (): void {
    $accepted = 0;

    for ($i = 0; $i < 40; $i++) {
        Identity::fresh();
        $status = $this->postJson('/api/v1/auth/device', [
            'email' => $this->user->email,
            'password' => Identity::PASSWORD,
            'device_name' => 'Bot '.$i,
            'fingerprint' => sprintf('fp-abuse-a-flood-%04d', $i),
        ])->status();
        $accepted += $status === 200 ? 1 : 0;
    }

    $devices = DB::table('user_devices')->where('user_id', $this->user->id)->count();

    // Safe: some cap (any) stops a single account from registering 40 live devices in a row,
    // each with its own per-device request budget and pull slot.
    expect($devices)->toBeLessThan(40, "accepted {$accepted} logins, {$devices} live devices");
});

it('ABA-RL-04 holds the per-user budget across many devices and re-logins', function (): void {
    config(['sync.throttle.device_per_minute' => 100, 'sync.throttle.user_per_minute' => 4]);

    $a = abuseALogin($this, 'fp-abuse-a-user-0001');
    $b = abuseALogin($this, 'fp-abuse-a-user-0002');
    SyncKit::manifestOf($this, abuseAHeaders($this, $a['token']))->assertOk();
    SyncKit::manifestOf($this, abuseAHeaders($this, $b['token']))->assertOk();
    $c = abuseALogin($this, 'fp-abuse-a-user-0003');
    SyncKit::manifestOf($this, abuseAHeaders($this, $c['token']))->assertOk();
    $a2 = abuseALogin($this, 'fp-abuse-a-user-0001');
    SyncKit::manifestOf($this, abuseAHeaders($this, $a2['token']))->assertOk();

    // Fifth request of the minute: refused on every device, new or re-logged in.
    $d = abuseALogin($this, 'fp-abuse-a-user-0004');
    abuseAThrottled(SyncKit::manifestOf($this, abuseAHeaders($this, $d['token'])));
    abuseAThrottled(abuseAPull($this, $a2['token']));
});

/**
 * Starts one AbuseAPullWorker per token at the same moment; returns their outcomes.
 *
 * @param  list<string>  $tokens
 * @return list<array{status: int, code: string|null}>
 */
function abuseAParallelPulls(object $test, array $tokens, int $perDevice, int $perUser, int $holdMs = 3000): array
{
    $config = config('database.connections.'.config('database.default'));
    $env = array_merge(getenv(), [
        'APP_ENV' => 'testing', 'DB_CONNECTION' => 'pgsql', 'DB_URL' => '', 'CACHE_STORE' => 'database', 'QUEUE_CONNECTION' => 'sync',
        'DB_HOST' => (string) $config['host'], 'DB_PORT' => (string) $config['port'],
        'DB_DATABASE' => (string) $config['database'], 'DB_USERNAME' => (string) $config['username'],
        'DB_PASSWORD' => (string) $config['password'], 'APP_KEY' => (string) config('app.key'),
        'BROADCAST_CONNECTION' => 'null', 'SESSION_DRIVER' => 'array', 'MAIL_MAILER' => 'array',
        'PULSE_ENABLED' => 'false', 'TELESCOPE_ENABLED' => 'false', 'NIGHTWATCH_ENABLED' => 'false', 'ASSISTANT_ENABLED' => 'false',
    ]);
    $startAt = sprintf('%.3f', microtime(true) + 8.0);
    $procs = [];

    foreach ($tokens as $i => $token) {
        $out = (string) tempnam(sys_get_temp_dir(), 'abA');
        $proc = proc_open(
            [PHP_BINARY, '-d', 'memory_limit=1G', base_path('tests/Feature/Attacks/AbuseAPullWorker.php'), $token, $test->company->id, $startAt, (string) $holdMs, (string) $perDevice, (string) $perUser],
            [1 => ['file', $out, 'w'], 2 => ['file', $out.'.err', 'w']], $pipes, base_path(), $env,
        );
        expect(is_resource($proc))->toBeTrue();
        $procs[$i] = [$proc, $out];
    }

    $results = [];

    foreach ($procs as [$proc, $out]) {
        for ($t = 0; $t < 600 && (proc_get_status($proc)['running'] ?? false); $t++) {
            usleep(100_000);
        }
        proc_close($proc);
        $raw = (string) @file_get_contents($out);
        $err = (string) @file_get_contents($out.'.err');
        @unlink($out);
        @unlink($out.'.err');
        $decoded = json_decode((string) strrchr('x'.$raw, '{'), true);
        expect($decoded)->toBeArray('worker failed: '.$raw.' '.$err);
        $results[] = ['status' => (int) $decoded['status'], 'code' => $decoded['code']];
    }

    return $results;
}

it('ABA-RL-05 never runs more parallel pulls of one user than concurrent_pulls_per_user (real processes)', function (): void {
    $tokens = [];

    foreach (['01', '02', '03', '04'] as $n) {
        $tokens[] = abuseALogin($this, 'fp-abuse-a-par-00'.$n)['token'];
    }

    $results = abuseAParallelPulls($this, $tokens, perDevice: 1, perUser: 2);
    $ok = count(array_filter($results, fn (array $r): bool => $r['status'] === 200));
    $refused = array_filter($results, fn (array $r): bool => $r['status'] === 429 && $r['code'] === 'TOO_MANY_ATTEMPTS');

    expect($ok)->toBe(2, json_encode($results))
        ->and(count($refused))->toBe(2, json_encode($results));
});

it('ABA-RL-06 never runs two parallel pulls of one device (real processes)', function (): void {
    $token = abuseALogin($this, 'fp-abuse-a-par-0100')['token'];

    $results = abuseAParallelPulls($this, [$token, $token, $token], perDevice: 1, perUser: 3);
    $ok = count(array_filter($results, fn (array $r): bool => $r['status'] === 200));

    expect($ok)->toBe(1, json_encode($results));
});

it('ABA-RL-07 does not reset the device budget or the refresh quota by refreshing the token', function (): void {
    config(['sync.throttle.device_per_minute' => 2, 'sync.throttle.user_per_minute' => 100, 'identity.device_tokens.refresh_per_device_per_minute' => 3]);
    $login = abuseALogin($this, 'fp-abuse-a-refresh-01');
    SyncKit::manifestOf($this, abuseAHeaders($this, $login['token']))->assertOk();
    SyncKit::manifestOf($this, abuseAHeaders($this, $login['token']))->assertOk();

    $refresh = $login['refresh_token'];
    $token = $login['token'];

    for ($i = 0; $i < 3; $i++) {
        Identity::fresh();
        $data = $this->postJson('/api/v1/auth/device/refresh', ['refresh_token' => $refresh])->assertOk()->json('data');
        [$refresh, $token] = [(string) $data['refresh_token'], (string) $data['token']];
        abuseAThrottled(SyncKit::manifestOf($this, abuseAHeaders($this, $token)));
    }

    // Fourth refresh in the minute: the device's refresh quota holds.
    Identity::fresh();
    abuseAThrottled($this->postJson('/api/v1/auth/device/refresh', ['refresh_token' => $refresh]));
});
