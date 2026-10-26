<?php

declare(strict_types=1);

use App\Modules\Identity\Models\DeviceRefreshToken;
use App\Modules\Identity\Models\UserDevice;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\Identity;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Identity::boot();
    $this->company = Identity::company();
    $this->admin = Identity::member($this->company, ['Admin'], ['email' => 'admin@example.com']);
    $this->user = Identity::member($this->company, ['Sales'], ['email' => 'deniz@example.com']);
});

function refreshLogin(string $fingerprint = 'fp-0123456789abcdef'): TestResponse
{
    Identity::fresh();

    return test()->postJson('/api/v1/auth/device', [
        'email' => 'deniz@example.com',
        'password' => Identity::PASSWORD,
        'device_name' => 'Office PC',
        'fingerprint' => $fingerprint,
    ])->assertOk();
}

function refreshWith(string $refreshToken): TestResponse
{
    Identity::fresh();

    return test()->postJson('/api/v1/auth/device/refresh', ['refresh_token' => $refreshToken]);
}

function meWith(string $token): TestResponse
{
    Identity::fresh();

    return test()->withToken($token)->getJson('/api/v1/auth/me');
}

it('returns a refresh token with the device login and stores it hashed', function (): void {
    $login = refreshLogin()->assertJsonStructure(['data' => ['token', 'expires_at', 'refresh_token', 'refresh_expires_at']]);

    $refresh = (string) $login->json('data.refresh_token');
    $row = DeviceRefreshToken::query()->sole();

    expect($row->token_hash)->toBe(hash('sha256', $refresh))
        ->and($row->token_hash)->not->toBe($refresh)
        ->and($row->used_at)->toBeNull()
        ->and(now()->diffInMinutes($login->json('data.expires_at'), absolute: true))->toBeLessThanOrEqual(60)
        ->and(now()->diffInDays($login->json('data.refresh_expires_at'), absolute: true))->toBeGreaterThan(29)
        ->and(json_encode(DB::table('device_refresh_tokens')->get()))->not->toContain($refresh);
});

it('rotates tokens on refresh and replaces the old access token', function (): void {
    $login = refreshLogin();
    $first = (string) $login->json('data.token');

    $refreshed = refreshWith((string) $login->json('data.refresh_token'))
        ->assertOk()
        ->assertJsonStructure(['data' => ['token', 'expires_at', 'refresh_token', 'refresh_expires_at']]);

    expect($refreshed->json('data.token'))->not->toBe($first)
        ->and($refreshed->json('data.refresh_token'))->not->toBe($login->json('data.refresh_token'))
        ->and($this->user->tokens()->count())->toBe(1)
        ->and(UserDevice::query()->count())->toBe(1);

    meWith($first)->assertStatus(401);
    meWith((string) $refreshed->json('data.token'))->assertOk();

    // The chain continues with the newest refresh token.
    refreshWith((string) $refreshed->json('data.refresh_token'))->assertOk();
});

it('slides the refresh lifetime on every use', function (): void {
    $login = refreshLogin();

    $this->travel(20)->days();
    $refreshed = refreshWith((string) $login->json('data.refresh_token'))->assertOk();

    expect(now()->diffInDays($refreshed->json('data.refresh_expires_at'), absolute: true))->toBeGreaterThan(29);

    $this->travel(20)->days();
    refreshWith((string) $refreshed->json('data.refresh_token'))->assertOk();
});

it('revokes the whole device when a used refresh token is presented again', function (): void {
    $login = refreshLogin();
    $old = (string) $login->json('data.refresh_token');
    $rotated = refreshWith($old)->assertOk();

    refreshWith($old)->assertStatus(401)->assertJsonPath('errors.code', 'UNAUTHENTICATED');

    expect(UserDevice::query()->count())->toBe(0)
        ->and(DeviceRefreshToken::query()->count())->toBe(0)
        ->and($this->user->tokens()->count())->toBe(0);

    meWith((string) $rotated->json('data.token'))->assertStatus(401);
    refreshWith((string) $rotated->json('data.refresh_token'))->assertStatus(401);
});

it('only revokes the offending device on reuse', function (): void {
    $a = refreshLogin('fp-aaaaaaaaaaaaaaaa');
    $b = refreshLogin('fp-bbbbbbbbbbbbbbbb');
    $old = (string) $a->json('data.refresh_token');
    refreshWith($old)->assertOk();
    refreshWith($old)->assertStatus(401);

    expect(UserDevice::query()->count())->toBe(1);
    refreshWith((string) $b->json('data.refresh_token'))->assertOk();
});

it('rejects unknown, missing and expired refresh tokens', function (): void {
    $login = refreshLogin();

    refreshWith('not-a-real-refresh-token')->assertStatus(401)->assertJsonPath('errors.code', 'UNAUTHENTICATED');
    Identity::fresh();
    $this->postJson('/api/v1/auth/device/refresh', [])->assertStatus(422)->assertJsonValidationErrors(['refresh_token'], 'errors.fields');

    $this->travel(31)->days();
    refreshWith((string) $login->json('data.refresh_token'))->assertStatus(401)->assertJsonPath('errors.code', 'UNAUTHENTICATED');
    expect(UserDevice::query()->count())->toBe(0);
});

it('rejects an expired access token after the access lifetime', function (): void {
    $login = refreshLogin();
    $token = (string) $login->json('data.token');

    meWith($token)->assertOk();

    $this->travel(61)->minutes();
    meWith($token)->assertStatus(401);

    $refreshed = refreshWith((string) $login->json('data.refresh_token'))->assertOk();
    meWith((string) $refreshed->json('data.token'))->assertOk();
});

it('removes refresh tokens when the user is deactivated', function (): void {
    $login = refreshLogin();

    Identity::fresh();
    $this->actingAs($this->admin)
        ->patchJson("/api/v1/users/{$this->user->id}/status", ['is_active' => false], Identity::headers($this->company))
        ->assertOk();

    expect(DeviceRefreshToken::query()->count())->toBe(0)
        ->and(UserDevice::query()->count())->toBe(0);
    refreshWith((string) $login->json('data.refresh_token'))->assertStatus(401);
});

it('removes refresh tokens on admin password reset', function (): void {
    $login = refreshLogin();

    Identity::fresh();
    $this->actingAs($this->admin)
        ->postJson("/api/v1/users/{$this->user->id}/password-reset", ['password' => 'admin-chosen-pass-1'], Identity::headers($this->company))
        ->assertSuccessful();

    expect(DeviceRefreshToken::query()->count())->toBe(0);
    refreshWith((string) $login->json('data.refresh_token'))->assertStatus(401);
});

it('removes the refresh tokens of other devices on password change', function (): void {
    $current = refreshLogin('fp-aaaaaaaaaaaaaaaa');
    $other = refreshLogin('fp-bbbbbbbbbbbbbbbb');

    Identity::fresh();
    $this->withToken((string) $current->json('data.token'))->postJson('/api/v1/auth/password/change', [
        'current_password' => Identity::PASSWORD,
        'password' => 'a-brand-new-passphrase',
        'password_confirmation' => 'a-brand-new-passphrase',
    ], Identity::headers())->assertNoContent();

    expect(UserDevice::query()->count())->toBe(1)
        ->and(DeviceRefreshToken::query()->count())->toBe(1);
    refreshWith((string) $other->json('data.refresh_token'))->assertStatus(401);
    refreshWith((string) $current->json('data.refresh_token'))->assertOk();
});

it('removes refresh tokens when the device is revoked or logs out', function (): void {
    $login = refreshLogin();
    $device = UserDevice::query()->sole();

    Identity::fresh();
    $this->withToken((string) $login->json('data.token'))->deleteJson("/api/v1/me/devices/{$device->id}")->assertNoContent();

    expect(DeviceRefreshToken::query()->count())->toBe(0);
    refreshWith((string) $login->json('data.refresh_token'))->assertStatus(401);

    $again = refreshLogin();
    Identity::fresh();
    $this->withToken((string) $again->json('data.token'))->postJson('/api/v1/auth/logout')->assertNoContent();
    expect(DeviceRefreshToken::query()->count())->toBe(0);
});

it('replaces the refresh token of a device that logs in again', function (): void {
    $first = refreshLogin();
    $second = refreshLogin();

    expect(DeviceRefreshToken::query()->count())->toBe(1);
    refreshWith((string) $first->json('data.refresh_token'))->assertStatus(401);
    refreshWith((string) $second->json('data.refresh_token'))->assertOk();
});

it('throttles the refresh endpoint', function (): void {
    for ($i = 0; $i < 20; $i++) {
        refreshWith('guess-'.$i)->assertStatus(401);
    }

    refreshWith('guess-final')->assertStatus(429);
});
