<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Tests\Feature\Sync\Support\SyncKit;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Actors;
use Tests\Support\Identity;
use Tests\Support\Sales\SalesKit;

/*
 * A new login with the same fingerprint ends the device's full download sessions. A pull that
 * started with the previous token and read its page before the login must not create a session
 * after it: two processes, the child pull paused between its read snapshot and its session
 * write while the parent logs in again.
 */
uses(SyncDatabase::class);

beforeEach(function (): void {
    $this->company = Actors::company();
    $this->user = Actors::user(['parties.view'], $this->company);
    SalesKit::party($this->company, ['name' => 'Race A']);
    SalesKit::party($this->company, ['name' => 'Race B']);
    SyncKit::waitVisible();
});

/** @return array{token: string, device: string} */
function raceLogin(object $test): array
{
    Identity::fresh();
    test()->flushHeaders();
    $token = (string) test()->postJson('/api/v1/auth/device', [
        'email' => $test->user->email, 'password' => Identity::PASSWORD, 'device_name' => 'Race PC', 'fingerprint' => 'fp-relogin-race-0001',
    ])->assertOk()->json('data.token');

    return ['token' => $token, 'device' => (string) DB::table('user_devices')->where('token_id', (string) strstr($token, '|', true))->value('id')];
}

/**
 * @param  list<string>  $args
 * @return array{0: resource, 1: string, 2: string}
 */
function raceSpawn(array $args): array
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
    $out = (string) tempnam(sys_get_temp_dir(), 'kpr');
    $process = proc_open([PHP_BINARY, base_path('tests/Fixtures/Sync/PullAfterReadWorker.php'), ...$args],
        [1 => ['file', $out, 'w'], 2 => ['file', $out.'.err', 'w']], $pipes, base_path(), $env);
    expect(is_resource($process))->toBeTrue();

    return [$process, $out, $out.'.err'];
}

/**
 * @param  array{0: resource, 1: string, 2: string}  $child
 * @return array<string, mixed>
 */
function raceWait(array $child): array
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

function raceMarker(): string
{
    $marker = (string) tempnam(sys_get_temp_dir(), 'kpm');
    unlink($marker);

    return $marker;
}

it('does not let a pull of the previous token create a session after the device logged in again', function (): void {
    $first = raceLogin($this);
    [$read, $go] = [raceMarker(), raceMarker()];
    $child = raceSpawn([$this->user->id, $this->company, $first['token'], 'parties', $read, $go]);

    for ($i = 0; $i < 400 && ! is_file($read); $i++) {
        usleep(50_000);
    }
    expect(is_file($read))->toBeTrue('child did not reach its session write: '.(string) @file_get_contents($child[2]));

    // The child has read its first page with the old token; the device logs in again.
    $again = raceLogin($this);
    file_put_contents($go, 'go');
    $result = raceWait($child);
    @unlink($read);
    @unlink($go);

    expect($result)->toMatchArray(['status' => 'ok', 'paused' => true, 'has_more' => true])
        ->and($again['device'])->toBe($first['device'])
        ->and(DB::table('sync_full_downloads')->where('device_id', $first['device'])->count())->toBe(0);

    // The new token starts its own download as usual.
    Identity::fresh();
    test()->flushHeaders();
    $page = test()->withHeaders(['Accept' => 'application/json', 'Authorization' => 'Bearer '.$again['token'], 'X-Company-Id' => $this->company])
        ->postJson('/api/v1/sync/pull', ['schema_version' => 1, 'resources' => [['resource' => 'parties', 'cursor' => null, 'limit' => 1]]])
        ->assertOk()->json('data.resources.0');

    expect($page['has_more'])->toBeTrue()
        ->and(DB::table('sync_full_downloads')->where('device_id', $first['device'])->count())->toBe(1);
});
