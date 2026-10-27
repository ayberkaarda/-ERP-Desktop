<?php

declare(strict_types=1);

use App\Modules\Identity\Models\UserDevice;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Testing\TestResponse;
use Tests\Support\Identity;

/*
 * A device is the user and its fingerprint: a new login with the same fingerprint keeps the same
 * user_devices row (so its request budget, pull slot and sessions stay its own) and ends the old
 * token pair. A user keeps at most ten active devices; the eleventh login retires the oldest.
 */
uses(RefreshDatabase::class);

beforeEach(function (): void {
    Identity::boot();
    $this->company = Identity::company();
    $this->user = Identity::member($this->company, ['Sales'], ['email' => 'deniz@example.com']);
});

/** @return array{token: string, refresh_token: string} */
function limitLogin(string $fingerprint): array
{
    Identity::fresh();
    $data = test()->postJson('/api/v1/auth/device', [
        'email' => 'deniz@example.com',
        'password' => Identity::PASSWORD,
        'device_name' => 'Office PC',
        'fingerprint' => $fingerprint,
    ])->assertOk()->json('data');

    return ['token' => (string) $data['token'], 'refresh_token' => (string) $data['refresh_token']];
}

function limitDeviceOf(string $token): ?string
{
    $value = UserDevice::query()->where('token_id', (string) strstr($token, '|', true))->value('id');

    return $value === null ? null : (string) $value;
}

function limitMe(string $token): TestResponse
{
    Identity::fresh();

    return test()->withToken($token)->getJson('/api/v1/auth/me');
}

function limitRefresh(string $refresh): TestResponse
{
    Identity::fresh();

    return test()->postJson('/api/v1/auth/device/refresh', ['refresh_token' => $refresh]);
}

it('keeps the user_devices row of a fingerprint on a new login and ends its old token pair', function (): void {
    $first = limitLogin('fp-limit-reuse-0001');
    $device = limitDeviceOf($first['token']);

    $again = limitLogin('fp-limit-reuse-0001');

    expect($device)->not->toBeNull()
        ->and(limitDeviceOf($again['token']))->toBe($device)
        ->and(UserDevice::query()->where('user_id', $this->user->id)->count())->toBe(1);
    limitMe($first['token'])->assertStatus(401);
    limitRefresh($first['refresh_token'])->assertStatus(401);
    limitMe($again['token'])->assertOk();
});

it('keeps at most ten active devices per user and retires the oldest on the next login', function (): void {
    $logins = [];

    foreach (range(1, 12) as $i) {
        Carbon::setTestNow(Carbon::parse('2027-06-01 09:00')->addMinutes($i));
        $logins[$i] = limitLogin(sprintf('fp-limit-cap-%04d', $i));
    }
    Carbon::setTestNow();

    expect(UserDevice::query()->where('user_id', $this->user->id)->count())->toBe(10)
        ->and(limitDeviceOf($logins[1]['token']))->toBeNull()
        ->and(limitDeviceOf($logins[2]['token']))->toBeNull();
    limitMe($logins[1]['token'])->assertStatus(401);
    limitMe($logins[2]['token'])->assertStatus(401);
    limitRefresh($logins[2]['refresh_token'])->assertStatus(401);

    foreach (range(3, 12) as $i) {
        limitMe($logins[$i]['token'])->assertOk();
    }
});

it('does not retire a device when a known fingerprint logs in again at the limit', function (): void {
    $logins = [];

    foreach (range(1, 10) as $i) {
        Carbon::setTestNow(Carbon::parse('2027-06-01 09:00')->addMinutes($i));
        $logins[$i] = limitLogin(sprintf('fp-limit-full-%04d', $i));
    }
    $fifth = limitDeviceOf($logins[5]['token']);
    Carbon::setTestNow(Carbon::parse('2027-06-01 10:00'));
    $again = limitLogin('fp-limit-full-0005');
    Carbon::setTestNow();

    expect(UserDevice::query()->where('user_id', $this->user->id)->count())->toBe(10)
        ->and(limitDeviceOf($again['token']))->toBe($fifth);
    limitMe($logins[1]['token'])->assertOk();
    limitMe($logins[5]['token'])->assertStatus(401);
});
