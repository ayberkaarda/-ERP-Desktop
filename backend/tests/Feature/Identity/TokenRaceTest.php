<?php

declare(strict_types=1);

use App\Core\Http\ApiException;
use App\Models\User;
use App\Modules\Identity\Models\DeviceRefreshToken;
use App\Modules\Identity\Models\PersonalAccessToken as DeviceAccessToken;
use App\Modules\Identity\Models\UserDevice;
use App\Modules\Identity\Services\DeviceTokens;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\PersonalAccessToken;
use Laravel\Sanctum\Sanctum;
use Tests\Support\Identity;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Identity::boot();
    $this->company = Identity::company();
    $this->user = Identity::member($this->company, ['Sales'], ['email' => 'deniz@example.com']);
});

afterEach(function (): void {
    Sanctum::$accessTokenAuthenticationCallback = null;
});

function tokenRaceLogin(string $fingerprint = 'fp-0123456789abcdef'): TestResponse
{
    Identity::fresh();

    return test()->postJson('/api/v1/auth/device', [
        'email' => 'deniz@example.com',
        'password' => Identity::PASSWORD,
        'device_name' => 'Office PC',
        'fingerprint' => $fingerprint,
    ])->assertOk();
}

function tokenRaceIssue(User $checked): array
{
    return app(DeviceTokens::class)->issue($checked, Request::create('/'), 'Office PC', 'fp-0123456789abcdef');
}

function tokenRaceErrorCode(Closure $call): ?string
{
    try {
        $call();
    } catch (ApiException $e) {
        return $e->errorCode->value;
    }

    return null;
}

// H1: the credentials were checked against $checked; the password change commits before minting.
it('refuses to mint a device token for a user whose password changed after the credential check', function (): void {
    $checked = User::query()->findOrFail($this->user->id);

    Identity::fresh();
    $this->actingAs($this->user)->postJson('/api/v1/auth/password/change', [
        'current_password' => Identity::PASSWORD,
        'password' => 'a-brand-new-passphrase',
        'password_confirmation' => 'a-brand-new-passphrase',
    ], Identity::headers())->assertNoContent();

    expect(tokenRaceErrorCode(fn () => tokenRaceIssue($checked)))->toBe('UNAUTHENTICATED')
        ->and(UserDevice::query()->count())->toBe(0)
        ->and(DeviceRefreshToken::query()->count())->toBe(0)
        ->and($this->user->tokens()->count())->toBe(0);
});

it('refuses to mint a device token for a user deactivated or deleted after the credential check', function (): void {
    $checked = User::query()->findOrFail($this->user->id);

    User::query()->whereKey($this->user->id)->update(['is_active' => false]);
    expect(tokenRaceErrorCode(fn () => tokenRaceIssue($checked)))->toBe('USER_DEACTIVATED');

    User::query()->whereKey($this->user->id)->delete();
    expect(tokenRaceErrorCode(fn () => tokenRaceIssue($checked)))->toBe('UNAUTHENTICATED')
        ->and(UserDevice::query()->count())->toBe(0);
});

it('mints with the locked user so the refresh family carries the current auth version', function (): void {
    $issued = tokenRaceIssue(User::query()->findOrFail($this->user->id));

    expect(DeviceRefreshToken::query()->sole()->auth_version)->toBe($this->user->fresh()?->auth_version);

    Identity::fresh();
    $this->postJson('/api/v1/auth/device/refresh', ['refresh_token' => $issued['refresh_token']])->assertOk();
});

it('bumps the auth version from the stored value, not from a stale model', function (): void {
    User::query()->whereKey($this->user->id)->update(['auth_version' => 5]);
    $stale = User::query()->findOrFail($this->user->id);
    $stale->auth_version = 3;

    Identity::fresh();
    $this->actingAs($stale)->postJson('/api/v1/auth/password/change', [
        'current_password' => Identity::PASSWORD,
        'password' => 'a-brand-new-passphrase',
        'password_confirmation' => 'a-brand-new-passphrase',
    ], Identity::headers())->assertNoContent();

    expect($this->user->fresh()?->auth_version)->toBe(6);
});

// H2: a refresh rotates the device after the logout request was authenticated by the old token.
it('ends the rotated token pair when logout runs with the access token a refresh just replaced', function (): void {
    $login = tokenRaceLogin();
    $refreshToken = (string) $login->json('data.refresh_token');
    $rotated = null;

    Sanctum::authenticateAccessTokensUsing(function (PersonalAccessToken $token, bool $valid) use (&$rotated, $refreshToken): bool {
        $rotated ??= app(DeviceTokens::class)->refresh($refreshToken, '127.0.0.1');

        return $valid;
    });

    Identity::fresh();
    $this->withToken((string) $login->json('data.token'))->postJson('/api/v1/auth/logout')->assertNoContent();
    Sanctum::$accessTokenAuthenticationCallback = null;

    expect($rotated)->toBeArray()
        ->and(UserDevice::query()->count())->toBe(0)
        ->and(DeviceRefreshToken::query()->count())->toBe(0)
        ->and($this->user->tokens()->count())->toBe(0);

    Identity::fresh();
    $this->withToken((string) $rotated['token'])->getJson('/api/v1/auth/me')->assertStatus(401);
    Identity::fresh();
    $this->postJson('/api/v1/auth/device/refresh', ['refresh_token' => $rotated['refresh_token']])->assertStatus(401);
});

it('keeps the device id on every access token of the device across refreshes', function (): void {
    $login = tokenRaceLogin();
    $device = UserDevice::query()->sole();

    Identity::fresh();
    $refreshed = $this->postJson('/api/v1/auth/device/refresh', ['refresh_token' => (string) $login->json('data.refresh_token')])->assertOk();

    $token = DeviceAccessToken::findToken((string) $refreshed->json('data.token'));
    expect($token?->getAttribute('device_id'))->toBe($device->id)
        ->and($device->fresh()?->token_id)->toBe((string) $token?->getKey());
});

it('does not let a token sign out a device of another user', function (): void {
    $login = tokenRaceLogin();
    $device = UserDevice::query()->sole();
    $other = Identity::member($this->company, ['Sales'], ['email' => 'mia@example.com']);
    $foreign = $other->createToken('Other', [DeviceTokens::ABILITY]);
    $foreign->accessToken->forceFill(['device_id' => $device->id])->save();

    Identity::fresh();
    $this->withToken($foreign->plainTextToken)->postJson('/api/v1/auth/logout')->assertNoContent();

    expect(UserDevice::query()->whereKey($device->id)->exists())->toBeTrue()
        ->and($other->tokens()->count())->toBe(0);
    Identity::fresh();
    $this->withToken((string) $login->json('data.token'))->getJson('/api/v1/auth/me')->assertOk();
});
