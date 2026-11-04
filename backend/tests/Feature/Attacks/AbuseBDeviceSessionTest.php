<?php

declare(strict_types=1);

use App\Models\User;
use App\Modules\Identity\Models\UserDevice;
use App\Modules\Identity\Services\UserAdministration;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Support\Actors;
use Tests\Support\Identity;

/*
 * B2 — device sessions: what a spent, revoked or logged-out device can still do on the sync
 * endpoints (manifest, pull, push) and on refresh. Real HTTP: /auth/device, /auth/device/refresh,
 * /me/devices, /auth/logout, /sync/*.
 */
uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->company = Actors::company();
    $this->user = Actors::user(['parties.view', 'parties.create']);
});

/** @return array{token: string, refresh_token: string} */
function abDevLogin(User $user, string $fingerprint = 'fp-abuse-b-dev-0001'): array
{
    Identity::fresh();
    test()->flushHeaders();
    $data = test()->postJson('/api/v1/auth/device', [
        'email' => $user->email, 'password' => Identity::PASSWORD, 'device_name' => 'Abuse PC', 'fingerprint' => $fingerprint,
    ])->assertOk()->json('data');

    return ['token' => (string) $data['token'], 'refresh_token' => (string) $data['refresh_token']];
}

function abDevRefresh(string $refresh): TestResponse
{
    Identity::fresh();
    test()->flushHeaders();

    return test()->postJson('/api/v1/auth/device/refresh', ['refresh_token' => $refresh]);
}

/** @return array<string, string> */
function abDevHeaders(string $token, string $company): array
{
    return ['Accept' => 'application/json', 'Authorization' => 'Bearer '.$token, 'X-Company-Id' => $company];
}

/**
 * Status codes of manifest, pull and push with the token.
 *
 * @return array{manifest: int, pull: int, push: int}
 */
function abDevSyncStatus(string $token, string $company): array
{
    $call = static function (string $method, string $uri, array $body = []) use ($token, $company): int {
        Identity::fresh();
        test()->flushHeaders();

        return test()->withHeaders(abDevHeaders($token, $company))->json($method, $uri, $body)->status();
    };

    return [
        'manifest' => $call('GET', '/api/v1/sync/manifest'),
        'pull' => $call('POST', '/api/v1/sync/pull', ['schema_version' => 1, 'resources' => [['resource' => 'parties', 'cursor' => null, 'limit' => 1]]]),
        'push' => $call('POST', '/api/v1/sync/push', ['schema_version' => 1, 'mutations' => [[
            'idempotency_key' => (string) Str::uuid7(), 'op' => 'create', 'resource' => 'parties', 'id' => (string) Str::uuid7(),
            'base_version' => null, 'changed_fields' => [], 'occurred_at' => '2027-06-14T10:00:00+03:00',
            'payload' => ['type' => 'customer', 'name' => 'Abuse '.Str::random(6)],
        ]]]),
    ];
}

const AB_DEV_DEAD = ['manifest' => 401, 'pull' => 401, 'push' => 401];

it('B2-00 baseline: a live device token reaches manifest, pull and push', function (): void {
    $login = abDevLogin($this->user);

    expect(abDevSyncStatus($login['token'], $this->company))->toBe(['manifest' => 200, 'pull' => 200, 'push' => 200]);
});

it('B2-01 a reused refresh token kills the whole family: the thief and the owner lose manifest, pull, push and refresh', function (): void {
    $login = abDevLogin($this->user);
    $owner = abDevRefresh($login['refresh_token'])->assertOk()->json('data');
    // The thief replays the spent token.
    abDevRefresh($login['refresh_token'])->assertStatus(401)->assertJsonPath('errors.code', 'UNAUTHENTICATED');

    expect(abDevSyncStatus((string) $owner['token'], $this->company))->toBe(AB_DEV_DEAD)
        ->and(abDevSyncStatus($login['token'], $this->company))->toBe(AB_DEV_DEAD);
    abDevRefresh((string) $owner['refresh_token'])->assertStatus(401);
    expect(UserDevice::query()->where('user_id', $this->user->id)->count())->toBe(0)
        ->and(DB::table('sync_full_downloads')->count())->toBe(0);
});

it('B2-02 a thief that refreshes first is cut off when the owner replays its now spent token', function (): void {
    $login = abDevLogin($this->user);
    $thief = abDevRefresh($login['refresh_token'])->assertOk()->json('data');
    abDevRefresh($login['refresh_token'])->assertStatus(401);

    expect(abDevSyncStatus((string) $thief['token'], $this->company))->toBe(AB_DEV_DEAD);
    abDevRefresh((string) $thief['refresh_token'])->assertStatus(401);
});

it('B2-03 a device revoked from /me/devices can neither refresh nor manifest, pull or push', function (): void {
    $login = abDevLogin($this->user);
    $rotated = abDevRefresh($login['refresh_token'])->assertOk()->json('data');
    $device = UserDevice::query()->where('user_id', $this->user->id)->sole();

    Identity::fresh();
    test()->flushHeaders();
    test()->actingAs($this->user, 'web')->withHeaders(['Accept' => 'application/json'])->deleteJson("/api/v1/me/devices/{$device->id}")->assertNoContent();

    expect(abDevSyncStatus((string) $rotated['token'], $this->company))->toBe(AB_DEV_DEAD);
    abDevRefresh((string) $rotated['refresh_token'])->assertStatus(401);
    abDevRefresh($login['refresh_token'])->assertStatus(401);
    expect(DB::table('device_refresh_tokens')->count())->toBe(0);
});

it('B2-04 another user cannot revoke or see a device it does not own', function (): void {
    $login = abDevLogin($this->user);
    $device = UserDevice::query()->where('user_id', $this->user->id)->sole();
    $other = Actors::user(['parties.view']);

    Identity::fresh();
    test()->flushHeaders();
    test()->actingAs($other, 'web')->withHeaders(['Accept' => 'application/json'])->deleteJson("/api/v1/me/devices/{$device->id}")->assertNotFound();

    expect(abDevSyncStatus($login['token'], $this->company)['pull'])->toBe(200);
});

it('B2-05 logout from the device ends the refresh family too', function (): void {
    $login = abDevLogin($this->user);
    Identity::fresh();
    test()->flushHeaders();
    test()->withHeaders(abDevHeaders($login['token'], $this->company))->postJson('/api/v1/auth/logout')->assertNoContent();

    abDevRefresh($login['refresh_token'])->assertStatus(401);
    expect(abDevSyncStatus($login['token'], $this->company))->toBe(AB_DEV_DEAD);
});

it('B2-06 deactivation cuts the device at once and a later reactivation does not bring the old refresh token back', function (): void {
    $login = abDevLogin($this->user);
    $admin = Actors::user([], null, ['is_super_admin' => true]);

    app(UserAdministration::class)->setStatus($admin, User::query()->findOrFail($this->user->id), false);
    expect(abDevSyncStatus($login['token'], $this->company))->toBe(AB_DEV_DEAD);
    abDevRefresh($login['refresh_token'])->assertStatus(401);

    app(UserAdministration::class)->setStatus($admin, User::query()->findOrFail($this->user->id), true);
    abDevRefresh($login['refresh_token'])->assertStatus(401);
    expect(abDevSyncStatus($login['token'], $this->company))->toBe(AB_DEV_DEAD);
});

it('B2-07 a password change in the browser ends every device: tokens and refresh tokens', function (): void {
    $a = abDevLogin($this->user, 'fp-abuse-b-dev-aaaa');
    $b = abDevLogin($this->user, 'fp-abuse-b-dev-bbbb');

    Identity::fresh();
    test()->flushHeaders();
    test()->actingAs($this->user, 'web')->withHeaders(['Accept' => 'application/json'])->postJson('/api/v1/auth/password/change', [
        'current_password' => Identity::PASSWORD, 'password' => 'N3w-Passw0rd!x', 'password_confirmation' => 'N3w-Passw0rd!x',
    ])->assertSuccessful();

    foreach ([$a, $b] as $device) {
        expect(abDevSyncStatus($device['token'], $this->company))->toBe(AB_DEV_DEAD);
        abDevRefresh($device['refresh_token'])->assertStatus(401);
    }
});

it('B2-08 a password change made from device A keeps A on a new family and ends device B', function (): void {
    $a = abDevLogin($this->user, 'fp-abuse-b-dev-aaaa');
    $b = abDevLogin($this->user, 'fp-abuse-b-dev-bbbb');

    Identity::fresh();
    test()->flushHeaders();
    $issued = test()->withHeaders(abDevHeaders($a['token'], $this->company))->postJson('/api/v1/auth/password/change', [
        'current_password' => Identity::PASSWORD, 'password' => 'N3w-Passw0rd!x', 'password_confirmation' => 'N3w-Passw0rd!x',
    ])->assertOk()->json('data');

    // A stolen copy of A's old pair is void; B is gone.
    expect(abDevSyncStatus($a['token'], $this->company))->toBe(AB_DEV_DEAD)
        ->and(abDevSyncStatus($b['token'], $this->company))->toBe(AB_DEV_DEAD)
        ->and(abDevSyncStatus((string) $issued['token'], $this->company)['pull'])->toBe(200);
    abDevRefresh($a['refresh_token'])->assertStatus(401);
    abDevRefresh($b['refresh_token'])->assertStatus(401);
    abDevRefresh((string) $issued['refresh_token'])->assertOk();
});

it('B2-09 a new login with the same fingerprint retires the previous pair of that device', function (): void {
    $first = abDevLogin($this->user);
    $second = abDevLogin($this->user);

    expect(abDevSyncStatus($first['token'], $this->company))->toBe(AB_DEV_DEAD);
    abDevRefresh($first['refresh_token'])->assertStatus(401);
    expect(abDevSyncStatus($second['token'], $this->company)['pull'])->toBe(200);
});
