<?php

declare(strict_types=1);

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Sync\Support\SyncKit;
use Tests\Fixtures\Sync\SyncDatabase;

/*
 * Sign-in locks the user, then the device (DeviceTokens::issue). A pull that starts a full
 * download session must take the same order: user, device, session row. With the device first,
 * the session INSERT waits for KEY SHARE on the user (foreign key) while sign-in holds the user
 * and waits for the device: a deadlock, one of the two aborted with 40P01. Two connections: the
 * test plays sign-in, a child process runs FullDownloads::start().
 */
uses(SyncDatabase::class);

beforeEach(function (): void {
    SyncKit::boot();
    [$this->company, $this->user] = SyncKit::actor(['fixtures.view']);
    SyncKit::headers($this->user, $this->company);
    $device = DB::table('user_devices')->where('user_id', $this->user->id)->first(['id', 'token_id']);
    $this->device = (string) $device->id;
    $this->tokenId = (string) $device->token_id;
    config(['database.connections.lock_order_login' => config('database.connections.'.config('database.default'))]);
});

afterEach(function (): void {
    DB::disconnect('lock_order_login');
});

/**
 * @param  list<string>  $args
 * @return array{0: resource, 1: string, 2: string}
 */
function lockOrderSpawn(array $args): array
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
    $out = (string) tempnam(sys_get_temp_dir(), 'klo');
    $process = proc_open([PHP_BINARY, base_path('tests/Fixtures/Sync/StartSessionWorker.php'), ...$args],
        [1 => ['file', $out, 'w'], 2 => ['file', $out.'.err', 'w']], $pipes, base_path(), $env);
    expect(is_resource($process))->toBeTrue();

    return [$process, $out, $out.'.err'];
}

/**
 * @param  array{0: resource, 1: string, 2: string}  $child
 * @return array<string, mixed>
 */
function lockOrderWait(array $child): array
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

/** Waits until another backend of this database waits for a lock (the child blocked on the user). */
function lockOrderAwaitBlocked(): bool
{
    for ($i = 0; $i < 300; $i++) {
        $waiting = DB::selectOne("select count(*) as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'");

        if ((int) ($waiting->n ?? 0) > 0) {
            return true;
        }
        usleep(50_000);
    }

    return false;
}

it('takes the user before the device when a pull starts a session, so a concurrent sign-in never deadlocks', function (): void {
    $login = DB::connection('lock_order_login');
    $login->beginTransaction();
    $login->statement("SET LOCAL lock_timeout = '10s'");
    // Sign-in holds the user row (DeviceTokens::issue).
    $login->select('SELECT id FROM users WHERE id = ? FOR UPDATE', [$this->user->id]);

    $child = lockOrderSpawn([$this->device, $this->user->id, $this->company->id, 'fixture-notes', $this->tokenId]);
    expect(lockOrderAwaitBlocked())->toBeTrue('the session write did not wait for the signed-in user');

    // Sign-in now takes the device, as DeviceTokens::issue does after the user.
    $signIn = 'ok';

    try {
        $login->select('SELECT id FROM user_devices WHERE id = ? FOR UPDATE', [$this->device]);
        $login->commit();
    } catch (QueryException $e) {
        $signIn = (string) ($e->errorInfo[0] ?? 'error');
        $login->rollBack();
    }

    $pull = lockOrderWait($child);

    // Both finish one after the other: sign-in first, then the session write with the same token.
    expect(['sign_in' => $signIn, 'pull' => $pull['status'], 'sqlstate' => $pull['sqlstate'] ?? null])
        ->toBe(['sign_in' => 'ok', 'pull' => 'ok', 'sqlstate' => null], (string) json_encode($pull))
        ->and($pull['sessions'])->toBe(1);
});
