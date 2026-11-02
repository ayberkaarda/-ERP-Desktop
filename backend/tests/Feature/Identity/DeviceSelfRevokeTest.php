<?php

declare(strict_types=1);

use App\Modules\Identity\Models\DeviceRefreshToken;
use App\Modules\Identity\Models\SessionLog;
use App\Modules\Identity\Models\UserDevice;
use Illuminate\Foundation\Testing\RefreshDatabase;
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

function selfRevokeLogin(string $name, string $fingerprint, string $email = 'deniz@example.com'): TestResponse
{
    Identity::fresh();

    return test()->postJson('/api/v1/auth/device', [
        'email' => $email,
        'password' => Identity::PASSWORD,
        'device_name' => $name,
        'fingerprint' => $fingerprint,
    ])->assertOk();
}

function revokeDeviceWith(string $token, string $deviceId): TestResponse
{
    Identity::fresh();

    return test()->withToken($token)->deleteJson("/api/v1/me/devices/{$deviceId}");
}

function selfRevokeMe(string $token): TestResponse
{
    Identity::fresh();

    return test()->withToken($token)->getJson('/api/v1/auth/me');
}

function deviceNamed(string $name): UserDevice
{
    return UserDevice::query()->where('name', $name)->sole();
}

function assertCurrentDeviceRefused(TestResponse $response): void
{
    $response->assertForbidden()
        ->assertExactJson(['errors' => ['code' => 'FORBIDDEN', 'message' => __('identity::auth.current_device')]]);
}

it('refuses to revoke the device whose access token made the request and keeps it signed in', function (): void {
    $login = selfRevokeLogin('Office PC', 'fp-office-000000000');
    $token = (string) $login->json('data.token');
    $device = deviceNamed('Office PC');
    $tokenId = $device->token_id;

    assertCurrentDeviceRefused(revokeDeviceWith($token, $device->id));

    expect(UserDevice::query()->whereKey($device->id)->exists())->toBeTrue()
        ->and($device->fresh()?->token_id)->toBe($tokenId)
        ->and($this->user->tokens()->whereKey($tokenId)->exists())->toBeTrue()
        ->and(DeviceRefreshToken::query()->where('device_id', $device->id)->count())->toBe(1);

    selfRevokeMe($token)->assertOk();
    Identity::fresh();
    $this->postJson('/api/v1/auth/device/refresh', ['refresh_token' => (string) $login->json('data.refresh_token')])->assertOk();
});

it('still revokes another device of the same user', function (): void {
    $office = (string) selfRevokeLogin('Office PC', 'fp-office-000000000')->json('data.token');
    $laptopLogin = selfRevokeLogin('Laptop', 'fp-laptop-000000000');
    $laptop = deviceNamed('Laptop');

    revokeDeviceWith($office, $laptop->id)->assertNoContent();

    expect(UserDevice::query()->whereKey($laptop->id)->exists())->toBeFalse()
        ->and(DeviceRefreshToken::query()->where('device_id', $laptop->id)->exists())->toBeFalse();
    selfRevokeMe((string) $laptopLogin->json('data.token'))->assertUnauthorized();
    selfRevokeMe($office)->assertOk();
});

it('lets a browser session revoke any of the user\'s devices', function (): void {
    $desktop = (string) selfRevokeLogin('Office PC', 'fp-office-000000000')->json('data.token');
    $device = deviceNamed('Office PC');

    Identity::fresh();
    $login = $this->postJson('/api/v1/auth/login', ['email' => 'deniz@example.com', 'password' => Identity::PASSWORD], Identity::headers())->assertOk();
    $cookie = Identity::sessionCookie($login);

    Identity::fresh();
    $this->withCredentials()->withCookie((string) config('session.cookie'), $cookie)
        ->deleteJson("/api/v1/me/devices/{$device->id}", [], Identity::headers())
        ->assertNoContent();

    expect(UserDevice::query()->whereKey($device->id)->exists())->toBeFalse();
    selfRevokeMe($desktop)->assertUnauthorized();

    Identity::fresh();
    $this->withCredentials()->withCookie((string) config('session.cookie'), $cookie)
        ->getJson('/api/v1/auth/me', Identity::headers())->assertOk();
});

it('keeps acting-as and device-less personal tokens able to revoke devices', function (): void {
    selfRevokeLogin('Office PC', 'fp-office-000000000');
    selfRevokeLogin('Laptop', 'fp-laptop-000000000');

    Identity::fresh();
    Sanctum::actingAs($this->user, ['*']);
    $this->deleteJson('/api/v1/me/devices/'.deviceNamed('Office PC')->id)->assertNoContent();

    $plain = $this->user->createToken('script', ['*'])->plainTextToken;
    revokeDeviceWith($plain, deviceNamed('Laptop')->id)->assertNoContent();

    expect(UserDevice::query()->where('user_id', $this->user->id)->count())->toBe(0);
});

it('refuses only the calling device among many', function (): void {
    $tokens = [];
    foreach (['A', 'B', 'C', 'D'] as $name) {
        $tokens[$name] = (string) selfRevokeLogin("PC {$name}", "fp-device-{$name}-0000000")->json('data.token');
    }
    selfRevokeLogin('Their PC', 'fp-theirs-000000000', 'other@example.com');

    assertCurrentDeviceRefused(revokeDeviceWith($tokens['B'], deviceNamed('PC B')->id));
    foreach (['A', 'C', 'D'] as $name) {
        revokeDeviceWith($tokens['B'], deviceNamed("PC {$name}")->id)->assertNoContent();
    }
    assertCurrentDeviceRefused(revokeDeviceWith($tokens['B'], deviceNamed('PC B')->id));
    revokeDeviceWith($tokens['B'], deviceNamed('Their PC')->id)->assertNotFound();

    expect(UserDevice::query()->where('user_id', $this->user->id)->pluck('name')->all())->toBe(['PC B'])
        ->and(UserDevice::query()->where('user_id', $this->other->id)->count())->toBe(1);
    selfRevokeMe($tokens['B'])->assertOk();
});

it('refuses the device after a refresh moved it to a new access token', function (): void {
    $login = selfRevokeLogin('Office PC', 'fp-office-000000000');
    $laptop = (string) selfRevokeLogin('Laptop', 'fp-laptop-000000000')->json('data.token');
    $device = deviceNamed('Office PC');

    Identity::fresh();
    $refreshed = $this->postJson('/api/v1/auth/device/refresh', ['refresh_token' => (string) $login->json('data.refresh_token')])->assertOk();
    $token = (string) $refreshed->json('data.token');

    revokeDeviceWith((string) $login->json('data.token'), $device->id)->assertUnauthorized();
    assertCurrentDeviceRefused(revokeDeviceWith($token, $device->id));

    expect(UserDevice::query()->whereKey($device->id)->exists())->toBeTrue();
    selfRevokeMe($token)->assertOk();

    // The other device can still revoke it.
    revokeDeviceWith($laptop, $device->id)->assertNoContent();
    selfRevokeMe($token)->assertUnauthorized();
});

it('leaks no token data in the refusal', function (): void {
    $login = selfRevokeLogin('Office PC', 'fp-office-000000000');
    $token = (string) $login->json('data.token');
    $device = deviceNamed('Office PC');

    $response = revokeDeviceWith($token, $device->id);
    assertCurrentDeviceRefused($response);

    $body = (string) $response->getContent();
    expect($body)->not->toContain((string) $device->token_id)
        ->and($body)->not->toContain(explode('|', $token)[1])
        ->and($body)->not->toContain((string) $login->json('data.refresh_token'))
        ->and($body)->not->toContain('fp-office-000000000')
        ->and($body)->not->toContain($device->id);
});

it('answers like the other self-protection rules of the identity module', function (): void {
    $admin = Identity::member($this->company, [], ['is_super_admin' => true, 'email' => 'root@example.com']);

    Identity::fresh();
    $self = $this->actingAs($admin)->deleteJson("/api/v1/users/{$admin->id}", [], Identity::headers($this->company));

    $token = (string) selfRevokeLogin('Office PC', 'fp-office-000000000')->json('data.token');
    $device = revokeDeviceWith($token, deviceNamed('Office PC')->id);

    expect($device->status())->toBe($self->status())
        ->and($device->json('errors.code'))->toBe($self->json('errors.code'))
        ->and(array_keys((array) $device->json('errors')))->toBe(array_keys((array) $self->json('errors')));
});

function selfRevokeBrowserCookie(): string
{
    Identity::fresh();
    $login = test()->postJson('/api/v1/auth/login', ['email' => 'deniz@example.com', 'password' => Identity::PASSWORD], Identity::headers())->assertOk();

    return Identity::sessionCookie($login);
}

/**
 * Everything a refused revoke could touch: device rows, access tokens, refresh rows, session log.
 *
 * @return array<int, mixed>
 */
function selfRevokeState(): array
{
    return [
        UserDevice::query()->orderBy('id')->get()->map->getAttributes()->all(),
        DeviceRefreshToken::query()->orderBy('id')->get()->map->getAttributes()->all(),
        test()->user->tokens()->orderBy('id')->get()->map(fn ($t): array => [$t->getKey(), $t->getAttributes()['token'], (string) $t->expires_at])->all(),
        SessionLog::query()->count(),
    ];
}

it('translates the refusal into the application locale', function (string $locale, string $text): void {
    $token = (string) selfRevokeLogin('Office PC', 'fp-office-000000000')->json('data.token');
    app()->setLocale($locale);

    revokeDeviceWith($token, deviceNamed('Office PC')->id)
        ->assertForbidden()
        ->assertExactJson(['errors' => ['code' => 'FORBIDDEN', 'message' => $text]]);
})->with([
    'tr' => ['tr', 'Bu cihaz kendini iptal edemez. Bunun yerine bu cihazda çıkış yapın.'],
    'de' => ['de', 'Dieses Gerät kann sich nicht selbst widerrufen. Melden Sie sich stattdessen auf diesem Gerät ab.'],
    'fr' => ['fr', 'Cet appareil ne peut pas se révoquer lui-même. Déconnectez-vous plutôt sur cet appareil.'],
    'en' => ['en', 'This device cannot revoke itself. Sign out on this device instead.'],
]);

it('lets a browser session revoke a device even when a stray device bearer header comes along', function (): void {
    $token = (string) selfRevokeLogin('Office PC', 'fp-office-000000000')->json('data.token');
    $device = deviceNamed('Office PC');
    $cookie = selfRevokeBrowserCookie();

    Identity::fresh();
    $this->withCredentials()->withCookie((string) config('session.cookie'), $cookie)->withToken($token)
        ->deleteJson("/api/v1/me/devices/{$device->id}", [], Identity::headers())
        ->assertNoContent();

    expect(UserDevice::query()->whereKey($device->id)->exists())->toBeFalse();
});

it('lets every kind of caller revoke a device that holds no access token', function (): void {
    $token = (string) selfRevokeLogin('Office PC', 'fp-office-000000000')->json('data.token');
    foreach (['Old PC 1' => 'fp-old1-0000000000', 'Old PC 2' => 'fp-old2-0000000000', 'Old PC 3' => 'fp-old3-0000000000'] as $name => $fingerprint) {
        selfRevokeLogin($name, $fingerprint);
        deviceNamed($name)->forceFill(['token_id' => null])->save();
    }

    revokeDeviceWith($token, deviceNamed('Old PC 1')->id)->assertNoContent();

    $cookie = selfRevokeBrowserCookie();
    Identity::fresh();
    $this->withCredentials()->withCookie((string) config('session.cookie'), $cookie)
        ->deleteJson('/api/v1/me/devices/'.deviceNamed('Old PC 2')->id, [], Identity::headers())
        ->assertNoContent();

    Identity::fresh();
    Sanctum::actingAs($this->user, ['*']);
    $this->deleteJson('/api/v1/me/devices/'.deviceNamed('Old PC 3')->id)->assertNoContent();

    expect(UserDevice::query()->where('name', 'like', 'Old PC%')->count())->toBe(0);
});

it('writes nothing when it refuses: no device, token, refresh or session log change', function (): void {
    $token = (string) selfRevokeLogin('Office PC', 'fp-office-000000000')->json('data.token');
    $this->travel(5)->minutes();
    $before = selfRevokeState();

    assertCurrentDeviceRefused(revokeDeviceWith($token, deviceNamed('Office PC')->id));

    expect(selfRevokeState())->toBe($before);
});

it('answers a repeated self-revoke the same way and a second revoke of a gone device with 404', function (): void {
    $token = (string) selfRevokeLogin('Office PC', 'fp-office-000000000')->json('data.token');
    selfRevokeLogin('Laptop', 'fp-laptop-000000000');
    $laptop = deviceNamed('Laptop');

    revokeDeviceWith($token, $laptop->id)->assertNoContent();
    revokeDeviceWith($token, $laptop->id)->assertNotFound()->assertJsonPath('errors.code', 'NOT_FOUND');

    $before = selfRevokeState();
    assertCurrentDeviceRefused(revokeDeviceWith($token, deviceNamed('Office PC')->id));
    assertCurrentDeviceRefused(revokeDeviceWith($token, deviceNamed('Office PC')->id));

    expect(selfRevokeState())->toBe($before);
});

it('tells apart devices with the same name by their access tokens', function (): void {
    $first = (string) selfRevokeLogin('PC', 'fp-first0000000000')->json('data.token');
    $second = (string) selfRevokeLogin('PC', 'fp-second000000000')->json('data.token');
    $third = (string) selfRevokeLogin('PC', 'fp-third0000000000')->json('data.token');
    $deviceOf = fn (string $token): string => (string) UserDevice::query()->where('token_id', explode('|', $token)[0])->value('id');
    [$firstId, $secondId, $thirdId] = [$deviceOf($first), $deviceOf($second), $deviceOf($third)];

    assertCurrentDeviceRefused(revokeDeviceWith($second, $secondId));
    revokeDeviceWith($second, $firstId)->assertNoContent();
    revokeDeviceWith($third, $secondId)->assertNoContent();
    assertCurrentDeviceRefused(revokeDeviceWith($third, $thirdId));

    expect(UserDevice::query()->pluck('id')->all())->toBe([$thirdId]);
});
