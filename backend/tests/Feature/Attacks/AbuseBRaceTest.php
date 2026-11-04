<?php

declare(strict_types=1);

use App\Models\User;
use App\Modules\Identity\Models\UserDevice;
use App\Modules\Identity\Services\DeviceTokens;
use App\Modules\Identity\Services\UserAdministration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Actors;
use Tests\Support\Identity;
use Tests\Support\Sales\SalesKit;

/*
 * B2/B1 races with a real second process (AbuseBRaceWorker.php) on committed data: a refresh
 * against a revoke, a password reset / deactivation and a second refresh of the same token, and
 * a web "send" of a quote against an offline edit of it.
 */
uses(SyncDatabase::class);

/**
 * @param  list<string>  $args
 * @return array{0: resource, 1: string, 2: string}
 */
function abRaceSpawn(array $args): array
{
    $config = config('database.connections.'.config('database.default'));
    $env = array_merge(getenv(), [
        'APP_ENV' => 'testing', 'DB_CONNECTION' => 'pgsql', 'DB_URL' => '', 'CACHE_STORE' => 'array', 'QUEUE_CONNECTION' => 'sync',
        'DB_HOST' => (string) $config['host'], 'DB_PORT' => (string) $config['port'],
        'DB_DATABASE' => (string) $config['database'], 'DB_USERNAME' => (string) $config['username'],
        'DB_PASSWORD' => (string) $config['password'], 'APP_KEY' => (string) config('app.key'),
        'BROADCAST_CONNECTION' => 'null', 'SESSION_DRIVER' => 'array', 'ASSISTANT_ENABLED' => 'false',
        'PULSE_ENABLED' => 'false', 'TELESCOPE_ENABLED' => 'false', 'NIGHTWATCH_ENABLED' => 'false',
    ]);
    $out = (string) tempnam(sys_get_temp_dir(), 'abr');
    $process = proc_open([PHP_BINARY, base_path('tests/Feature/Attacks/AbuseBRaceWorker.php'), ...$args],
        [1 => ['file', $out, 'w'], 2 => ['file', $out.'.err', 'w']], $pipes, base_path(), $env);
    expect(is_resource($process))->toBeTrue();

    return [$process, $out, $out.'.err'];
}

/**
 * @param  array{0: resource, 1: string, 2: string}  $child
 * @return array<string, mixed>
 */
function abRaceWait(array $child): array
{
    [$process, $out, $err] = $child;

    for ($i = 0; $i < 600 && (proc_get_status($process)['running'] ?? false); $i++) {
        usleep(50_000);
    }
    proc_close($process);
    $body = (string) @file_get_contents($out);
    $error = (string) @file_get_contents($err);
    @unlink($out);
    @unlink($err);
    $decoded = json_decode($body, true);
    expect($decoded)->toBeArray("child said: {$body} {$error}");

    return $decoded;
}

function abRaceMarker(): string
{
    $marker = (string) tempnam(sys_get_temp_dir(), 'abm');
    unlink($marker);

    return $marker;
}

function abRaceAwaitMarker(string $marker, array $child): void
{
    for ($i = 0; $i < 400 && ! is_file($marker); $i++) {
        usleep(50_000);
    }
    expect(is_file($marker))->toBeTrue('child did not take its lock: '.(string) @file_get_contents($child[2]));
    @unlink($marker);
}

/** Waits until some backend of this database waits for a lock (the child blocked on ours). */
function abRaceAwaitBlocked(): bool
{
    for ($i = 0; $i < 300; $i++) {
        // pg_stat_activity is cached per transaction; the caller holds one open.
        DB::connection()->select('select pg_stat_clear_snapshot()');
        $waiting = DB::connection()->selectOne("select count(*) as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'");

        if ((int) ($waiting->n ?? 0) > 0) {
            return true;
        }
        usleep(50_000);
    }

    return false;
}

/** @return array{token: string, refresh_token: string} */
function abRaceLogin(User $user, string $fingerprint = 'fp-abuse-b-race-0001'): array
{
    Identity::fresh();
    test()->flushHeaders();
    $data = test()->postJson('/api/v1/auth/device', [
        'email' => $user->email, 'password' => Identity::PASSWORD, 'device_name' => 'Race PC', 'fingerprint' => $fingerprint,
    ])->assertOk()->json('data');

    return ['token' => (string) $data['token'], 'refresh_token' => (string) $data['refresh_token']];
}

function abRacePullStatus(string $token, string $company): int
{
    Identity::fresh();
    test()->flushHeaders();

    return test()->withHeaders(['Accept' => 'application/json', 'Authorization' => 'Bearer '.$token, 'X-Company-Id' => $company])
        ->postJson('/api/v1/sync/pull', ['schema_version' => 1, 'resources' => [['resource' => 'parties', 'cursor' => null, 'limit' => 1]]])->status();
}

function abRaceRefreshStatus(string $refresh): int
{
    Identity::fresh();
    test()->flushHeaders();

    return test()->postJson('/api/v1/auth/device/refresh', ['refresh_token' => $refresh])->status();
}

beforeEach(function (): void {
    $this->company = Actors::company();
    $this->user = Actors::user(['parties.view', 'parties.create']);
});

it('B2-R1 a refresh holding the device lock, then a revoke: the pair the refresh minted is dead', function (): void {
    $login = abRaceLogin($this->user);
    $device = UserDevice::query()->where('user_id', $this->user->id)->sole();
    $marker = abRaceMarker();
    $child = abRaceSpawn(['refresh', $login['refresh_token'], $marker, '2500']);
    abRaceAwaitMarker($marker, $child);

    // The revoke waits for the refresh to commit, then takes the device with its new token.
    Identity::fresh();
    test()->flushHeaders();
    test()->actingAs($this->user, 'web')->withHeaders(['Accept' => 'application/json'])->deleteJson("/api/v1/me/devices/{$device->id}")->assertNoContent();
    $minted = abRaceWait($child);

    expect($minted['status'])->toBe('ok')
        ->and(abRacePullStatus((string) $minted['token'], $this->company))->toBe(401)
        ->and(abRaceRefreshStatus((string) $minted['refresh_token']))->toBe(401)
        ->and(UserDevice::query()->where('user_id', $this->user->id)->count())->toBe(0)
        ->and(DB::table('personal_access_tokens')->where('tokenable_id', $this->user->id)->count())->toBe(0);
});

it('B2-R2 a revoke holding the device lock, then a refresh: the refresh gets nothing', function (): void {
    $login = abRaceLogin($this->user);
    $device = UserDevice::query()->where('user_id', $this->user->id)->sole();

    DB::beginTransaction();
    UserDevice::query()->whereKey($device->id)->lockForUpdate()->first();
    app(DeviceTokens::class)->revoke($this->user, $device);
    $child = abRaceSpawn(['refresh', $login['refresh_token'], abRaceMarker(), '0']);
    $blocked = abRaceAwaitBlocked();
    DB::commit();
    $result = abRaceWait($child);

    expect($blocked)->toBeTrue()
        ->and($result)->toBe(['status' => 'error', 'code' => 'UNAUTHENTICATED'])
        ->and(DB::table('personal_access_tokens')->where('tokenable_id', $this->user->id)->count())->toBe(0);
});

it('B2-R3 deactivation (revoke all) racing a refresh that holds the lock leaves no live token', function (): void {
    $login = abRaceLogin($this->user);
    $admin = Actors::user([], null, ['is_super_admin' => true]);
    $marker = abRaceMarker();
    $child = abRaceSpawn(['refresh', $login['refresh_token'], $marker, '2500']);
    abRaceAwaitMarker($marker, $child);

    app(UserAdministration::class)->setStatus($admin, User::query()->findOrFail($this->user->id), false);
    $minted = abRaceWait($child);

    expect($minted['status'])->toBe('ok')
        ->and(abRacePullStatus((string) $minted['token'], $this->company))->toBe(401)
        ->and(abRaceRefreshStatus((string) $minted['refresh_token']))->toBe(401)
        ->and(DB::table('personal_access_tokens')->where('tokenable_id', $this->user->id)->count())->toBe(0)
        ->and(UserDevice::query()->where('user_id', $this->user->id)->count())->toBe(0);
});

it('B2-R4 two refreshes of the same token at once never leave two live pairs', function (): void {
    $login = abRaceLogin($this->user);
    $marker = abRaceMarker();
    $child = abRaceSpawn(['refresh', $login['refresh_token'], $marker, '2000']);
    abRaceAwaitMarker($marker, $child);

    // The second refresh waits for the first, then finds its token spent: reuse, the family dies.
    $second = abRaceRefreshStatus($login['refresh_token']);
    $first = abRaceWait($child);

    expect($first['status'])->toBe('ok')->and($second)->toBe(401)
        ->and(abRacePullStatus((string) $first['token'], $this->company))->toBe(401)
        ->and(abRaceRefreshStatus((string) $first['refresh_token']))->toBe(401)
        ->and(UserDevice::query()->where('user_id', $this->user->id)->count())->toBe(0);
});

it('B1-R1 a web send racing an offline edit of the draft: the edit is DOCUMENT_LOCKED, never applied over the sent quote', function (): void {
    $w = SalesKit::world(stock: false);
    $quote = SalesKit::post($w->user, $w->company, 'sales-quotes', [
        'party_id' => $w->party->id, 'document_date' => '2027-06-10', 'notes' => 'Original',
        'lines' => [['item_id' => $w->item->id, 'quantity' => '2', 'unit_price' => '120']],
    ])->assertCreated()->json('data');
    $login = abRaceLogin($w->user, 'fp-abuse-b-race-sales');
    $marker = abRaceMarker();
    $child = abRaceSpawn(['send', $w->company, $quote['id'], $w->user->id, $marker, '2500']);
    abRaceAwaitMarker($marker, $child);

    // The push waits for the row lock only up to sync.push.lock_timeout_ms (then 409 IDEMPOTENCY_IN_PROGRESS);
    // allow more than the sender holds it so the wait ends in DOCUMENT_LOCKED.
    config(['sync.push.lock_timeout_ms' => 15000]);
    Identity::fresh();
    test()->flushHeaders();
    $result = test()->withHeaders(['Accept' => 'application/json', 'Authorization' => 'Bearer '.$login['token'], 'X-Company-Id' => $w->company])
        ->postJson('/api/v1/sync/push', ['schema_version' => 1, 'mutations' => [[
            'idempotency_key' => (string) Str::uuid7(), 'op' => 'update', 'resource' => 'sales-quotes', 'id' => $quote['id'],
            'base_version' => (int) $quote['version'], 'changed_fields' => ['notes'], 'occurred_at' => '2027-06-14T10:00:00+03:00',
            'payload' => ['notes' => 'offline edit'],
        ]]])->assertOk()->json('data.results.0');
    $sent = abRaceWait($child);

    expect($sent['status'])->toBe('ok')->and($sent['status_after'])->toBe('sent')
        ->and($result['status'])->toBe('conflict')
        ->and($result['conflict']['code'])->toBe('DOCUMENT_LOCKED')
        ->and(DB::table('sales_quotes')->where('id', $quote['id'])->value('notes'))->toBe('Original')
        ->and(DB::table('sales_quotes')->where('id', $quote['id'])->value('status'))->toBe('sent');
});
