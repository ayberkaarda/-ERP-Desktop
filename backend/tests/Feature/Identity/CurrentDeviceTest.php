<?php

declare(strict_types=1);

use App\Modules\Identity\Models\UserDevice;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Tests\Support\Identity;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Identity::boot();
    $this->company = Identity::company();
    $this->user = Identity::member($this->company, ['Sales'], ['email' => 'deniz@example.com']);
    $this->other = Identity::member($this->company, ['Sales'], ['email' => 'other@example.com']);
});

function currentDeviceLogin(string $name, string $fingerprint, string $email = 'deniz@example.com'): TestResponse
{
    Identity::fresh();

    return test()->postJson('/api/v1/auth/device', [
        'email' => $email,
        'password' => Identity::PASSWORD,
        'device_name' => $name,
        'fingerprint' => $fingerprint,
    ])->assertOk();
}

/**
 * @return array<string, bool> device name => is_current
 */
function currentFlags(TestResponse $response): array
{
    return collect($response->assertOk()->json('data'))->mapWithKeys(fn (array $d): array => [$d['name'] => $d['is_current']])->sortKeys()->all();
}

function devicesWithToken(string $token): TestResponse
{
    Identity::fresh();

    return test()->withToken($token)->getJson('/api/v1/me/devices');
}

it('marks only the device whose access token made the request', function (): void {
    $office = (string) currentDeviceLogin('Office PC', 'fp-office-000000000')->json('data.token');
    $laptop = (string) currentDeviceLogin('Laptop', 'fp-laptop-000000000')->json('data.token');
    currentDeviceLogin('Their PC', 'fp-theirs-000000000', 'other@example.com');

    expect(currentFlags(devicesWithToken($office)))->toBe(['Laptop' => false, 'Office PC' => true])
        ->and(currentFlags(devicesWithToken($laptop)))->toBe(['Laptop' => true, 'Office PC' => false]);
});

it('returns is_current as a boolean and leaks no token data', function (): void {
    $login = currentDeviceLogin('Office PC', 'fp-office-000000000');
    $token = (string) $login->json('data.token');
    $device = UserDevice::query()->sole();

    $response = devicesWithToken($token)
        ->assertExactJsonStructure(['data' => [['id', 'name', 'ip_address', 'user_agent', 'last_used_at', 'expires_at', 'created_at', 'is_current']]])
        ->assertJsonPath('data.0.is_current', true);

    $body = (string) $response->getContent();
    expect($body)->not->toContain((string) $device->token_id)
        ->and($body)->not->toContain('token')
        ->and($body)->not->toContain((string) $login->json('data.refresh_token'))
        ->and($body)->not->toContain(explode('|', $token)[1]);
});

it('follows the device to its new access token after a refresh', function (): void {
    $login = currentDeviceLogin('Office PC', 'fp-office-000000000');
    currentDeviceLogin('Laptop', 'fp-laptop-000000000');

    Identity::fresh();
    $refreshed = $this->postJson('/api/v1/auth/device/refresh', ['refresh_token' => (string) $login->json('data.refresh_token')])->assertOk();

    expect(currentFlags(devicesWithToken((string) $refreshed->json('data.token'))))->toBe(['Laptop' => false, 'Office PC' => true]);
    devicesWithToken((string) $login->json('data.token'))->assertStatus(401);
});

it('marks no device for a browser session, even when the user has devices', function (): void {
    currentDeviceLogin('Office PC', 'fp-office-000000000');
    currentDeviceLogin('Laptop', 'fp-laptop-000000000');

    Identity::fresh();
    $cookie = Identity::sessionCookie(
        $this->postJson('/api/v1/auth/login', ['email' => 'deniz@example.com', 'password' => Identity::PASSWORD], Identity::headers())->assertOk()
    );

    Identity::fresh();
    $response = $this->withCredentials()->withCookie((string) config('session.cookie'), $cookie)
        ->getJson('/api/v1/me/devices', Identity::headers());

    expect(currentFlags($response))->toBe(['Laptop' => false, 'Office PC' => false]);
});

it('marks no device for a transient or acting-as token', function (): void {
    currentDeviceLogin('Office PC', 'fp-office-000000000');

    Identity::fresh();
    Sanctum::actingAs($this->user, ['desktop']);
    expect(currentFlags($this->getJson('/api/v1/me/devices')))->toBe(['Office PC' => false]);

    Identity::fresh();
    expect(currentFlags($this->actingAs($this->user)->getJson('/api/v1/me/devices')))->toBe(['Office PC' => false]);
});

it('marks no device for a personal token that belongs to no device', function (): void {
    currentDeviceLogin('Office PC', 'fp-office-000000000');
    $plain = $this->user->createToken('script', ['desktop'])->plainTextToken;

    expect(currentFlags(devicesWithToken($plain)))->toBe(['Office PC' => false]);
});

it('marks no device that lost its access token', function (): void {
    $token = (string) currentDeviceLogin('Office PC', 'fp-office-000000000')->json('data.token');
    currentDeviceLogin('Laptop', 'fp-laptop-000000000');
    UserDevice::query()->where('name', 'Laptop')->update(['token_id' => null]);

    expect(currentFlags(devicesWithToken($token)))->toBe(['Laptop' => false, 'Office PC' => true]);
});

it('drops a revoked device and keeps the caller current', function (): void {
    $office = (string) currentDeviceLogin('Office PC', 'fp-office-000000000')->json('data.token');
    $laptop = (string) currentDeviceLogin('Laptop', 'fp-laptop-000000000')->json('data.token');
    $laptopId = UserDevice::query()->where('name', 'Laptop')->value('id');

    Identity::fresh();
    $this->withToken($office)->deleteJson("/api/v1/me/devices/{$laptopId}")->assertNoContent();

    expect(currentFlags(devicesWithToken($office)))->toBe(['Office PC' => true]);
    devicesWithToken($laptop)->assertStatus(401);
});

it('never lists another user\'s device, even the one whose token is in use', function (): void {
    currentDeviceLogin('Office PC', 'fp-office-000000000');
    $theirs = (string) currentDeviceLogin('Their PC', 'fp-theirs-000000000', 'other@example.com')->json('data.token');

    expect(currentFlags(devicesWithToken($theirs)))->toBe(['Their PC' => true]);
});

it('marks exactly one of many devices without a query per device', function (): void {
    $count = function (string $token): int {
        Identity::fresh();
        DB::flushQueryLog();
        DB::enableQueryLog();
        $this->withToken($token)->getJson('/api/v1/me/devices')->assertOk();
        // Sanctum stamps the token's last_used_at only when the second changed; that write is not ours.
        $queries = collect(DB::getQueryLog())
            ->reject(fn (array $q): bool => str_starts_with($q['query'], 'update "personal_access_tokens"'))
            ->count();
        DB::disableQueryLog();

        return $queries;
    };

    $first = (string) currentDeviceLogin('Device 0', 'fp-device-0-0000000')->json('data.token');
    $one = $count($first);

    foreach (range(1, 6) as $i) {
        currentDeviceLogin("Device {$i}", "fp-device-{$i}-0000000");
    }

    $flags = currentFlags(devicesWithToken($first));
    expect($flags)->toHaveCount(7)
        ->and(array_keys(array_filter($flags)))->toBe(['Device 0'])
        ->and($count($first))->toBe($one);
});

it('tells apart two devices with the same name by their access tokens', function (): void {
    $first = (string) currentDeviceLogin('Office PC', 'fp-office-1-0000000')->json('data.token');
    $this->travel(1)->minutes();
    $second = (string) currentDeviceLogin('Office PC', 'fp-office-2-0000000')->json('data.token');

    $currentIds = fn (string $token): array => collect(devicesWithToken($token)->assertOk()->json('data'))
        ->where('is_current', true)->pluck('id')->values()->all();
    $deviceOf = fn (string $token): string => UserDevice::query()->where('token_id', explode('|', $token)[0])->sole()->id;

    expect($currentIds($first))->toBe([$deviceOf($first)])
        ->and($currentIds($second))->toBe([$deviceOf($second)]);
});

it('marks no device for a browser session that also sends a device bearer header', function (): void {
    $token = (string) currentDeviceLogin('Office PC', 'fp-office-000000000')->json('data.token');

    Identity::fresh();
    $cookie = Identity::sessionCookie(
        $this->postJson('/api/v1/auth/login', ['email' => 'deniz@example.com', 'password' => Identity::PASSWORD], Identity::headers())->assertOk()
    );

    Identity::fresh();
    $response = $this->withCredentials()->withCookie((string) config('session.cookie'), $cookie)->withToken($token)
        ->getJson('/api/v1/me/devices', Identity::headers());

    expect(currentFlags($response))->toBe(['Office PC' => false]);
});

it('lists devices newest first by creation, not by last use', function (): void {
    $old = currentDeviceLogin('Old', 'fp-old-00000000000');
    $this->travel(1)->minutes();
    currentDeviceLogin('Mid', 'fp-mid-00000000000');
    $this->travel(1)->minutes();
    currentDeviceLogin('New', 'fp-new-00000000000');
    $this->travel(1)->minutes();

    Identity::fresh();
    $refreshed = $this->postJson('/api/v1/auth/device/refresh', ['refresh_token' => (string) $old->json('data.refresh_token')])->assertOk();

    $data = devicesWithToken((string) $refreshed->json('data.token'))->assertOk()->json('data');
    expect(array_column($data, 'name'))->toBe(['New', 'Mid', 'Old'])
        ->and(array_column($data, 'is_current'))->toBe([false, false, true]);
});
