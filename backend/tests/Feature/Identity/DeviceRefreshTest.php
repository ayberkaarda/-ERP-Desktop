<?php

declare(strict_types=1);

use App\Modules\Identity\Models\DeviceRefreshToken;
use App\Modules\Identity\Models\UserDevice;
use App\Modules\Identity\Services\DeviceTokens;
use App\Modules\Identity\Services\TwoFactorService;
use App\Modules\Organization\Contracts\CompanyDirectory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use PragmaRX\Google2FA\Google2FA;
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

it('voids every old refresh token on password change and gives the changing device a new family', function (): void {
    $current = refreshLogin('fp-aaaaaaaaaaaaaaaa');
    $other = refreshLogin('fp-bbbbbbbbbbbbbbbb');

    Identity::fresh();
    $changed = $this->withToken((string) $current->json('data.token'))->postJson('/api/v1/auth/password/change', [
        'current_password' => Identity::PASSWORD,
        'password' => 'a-brand-new-passphrase',
        'password_confirmation' => 'a-brand-new-passphrase',
    ], Identity::headers())->assertOk()
        ->assertJsonStructure(['data' => ['token', 'expires_at', 'refresh_token', 'refresh_expires_at']]);

    expect(UserDevice::query()->count())->toBe(1)
        ->and(DeviceRefreshToken::query()->count())->toBe(1);

    // The copied pre-change refresh tokens are dead, including the one of the changing device.
    refreshWith((string) $other->json('data.refresh_token'))->assertStatus(401);
    refreshWith((string) $current->json('data.refresh_token'))->assertStatus(401);

    meWith((string) $current->json('data.token'))->assertStatus(401);
    meWith((string) $changed->json('data.token'))->assertOk();
    refreshWith((string) $changed->json('data.refresh_token'))->assertOk();
});

it('answers a browser password change without tokens', function (): void {
    refreshLogin();

    Identity::fresh();
    $this->actingAs($this->user)->postJson('/api/v1/auth/password/change', [
        'current_password' => Identity::PASSWORD,
        'password' => 'a-brand-new-passphrase',
        'password_confirmation' => 'a-brand-new-passphrase',
    ], Identity::headers())->assertNoContent();

    expect(DeviceRefreshToken::query()->count())->toBe(0);
});

it('voids refresh tokens when two-factor is enabled and then demands TOTP at login', function (): void {
    $login = refreshLogin();
    $google = app(Google2FA::class);

    Identity::fresh();
    $setup = app(TwoFactorService::class)->beginSetup($this->user);
    $secret = (string) ($setup['secret'] ?? $this->user->fresh()?->two_factor_secret);
    app(TwoFactorService::class)->confirm($this->user->fresh(), $google->getCurrentOtp($secret));

    refreshWith((string) $login->json('data.refresh_token'))->assertStatus(401)->assertJsonPath('errors.code', 'UNAUTHENTICATED');
    expect(UserDevice::query()->count())->toBe(0);

    Identity::fresh();
    $this->postJson('/api/v1/auth/device', [
        'email' => 'deniz@example.com', 'password' => Identity::PASSWORD,
        'device_name' => 'Office PC', 'fingerprint' => 'fp-0123456789abcdef',
    ])->assertStatus(401)->assertJsonPath('errors.code', 'TWO_FACTOR_REQUIRED');
});

it('keeps spent refresh tokens so a stale replay revokes a long-lived family', function (): void {
    $t0 = refreshLogin();
    $this->travel(20)->days();
    $t1 = refreshWith((string) $t0->json('data.refresh_token'))->assertOk();
    $this->travel(20)->days();
    $t2 = refreshWith((string) $t1->json('data.refresh_token'))->assertOk();

    // t0 is 40 days old and expired; it is still remembered as spent.
    expect(DeviceRefreshToken::query()->count())->toBe(3);
    refreshWith((string) $t0->json('data.refresh_token'))->assertStatus(401);

    expect(UserDevice::query()->count())->toBe(0);
    meWith((string) $t2->json('data.token'))->assertStatus(401);
    refreshWith((string) $t2->json('data.refresh_token'))->assertStatus(401);
});

it('revokes the access token minted by a refresh that ran before the revoke took its lock', function (): void {
    $login = refreshLogin();
    $stale = UserDevice::query()->sole();

    $refreshed = refreshWith((string) $login->json('data.refresh_token'))->assertOk();
    // The revoke still holds the device as read before the refresh (old token_id).
    app(DeviceTokens::class)->revoke($this->user, $stale);

    expect($this->user->tokens()->count())->toBe(0);
    meWith((string) $refreshed->json('data.token'))->assertStatus(401);
    refreshWith((string) $refreshed->json('data.refresh_token'))->assertStatus(401);
});

it('isolates users and devices from each other', function (): void {
    $mine = refreshLogin('fp-aaaaaaaaaaaaaaaa');
    $other = Identity::member($this->company, ['Sales'], ['email' => 'mia@example.com']);
    Identity::fresh();
    $theirs = $this->postJson('/api/v1/auth/device', [
        'email' => 'mia@example.com', 'password' => Identity::PASSWORD,
        'device_name' => 'Mia PC', 'fingerprint' => 'fp-mmmmmmmmmmmmmmmm',
    ])->assertOk();

    // Reuse on my device never touches hers.
    $old = (string) $mine->json('data.refresh_token');
    refreshWith($old)->assertOk();
    refreshWith($old)->assertStatus(401);
    expect(UserDevice::query()->where('user_id', $other->id)->count())->toBe(1);
    refreshWith((string) $theirs->json('data.refresh_token'))->assertOk();

    // My token cannot delete her device.
    $device = UserDevice::query()->where('user_id', $other->id)->sole();
    $again = refreshLogin('fp-cccccccccccccccc');
    Identity::fresh();
    $this->withToken((string) $again->json('data.token'))->deleteJson("/api/v1/me/devices/{$device->id}")->assertNotFound();
    expect(UserDevice::query()->where('user_id', $other->id)->count())->toBe(1);
});

it('lets a refreshed token pair stop at company access once membership is lost', function (): void {
    $login = refreshLogin();
    app(CompanyDirectory::class)->setMembership($this->user->id, $this->company->id, false);

    $refreshed = refreshWith((string) $login->json('data.refresh_token'))->assertOk();

    Identity::fresh();
    $this->withToken((string) $refreshed->json('data.token'))->getJson('/api/v1/users', Identity::headers($this->company))
        ->assertStatus(403);
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

it('limits failed refresh attempts per IP without blocking other devices behind the same IP', function (): void {
    $logins = [];
    foreach (range(1, 5) as $n) {
        $logins[] = refreshLogin('fp-device-'.str_pad((string) $n, 10, '0', STR_PAD_LEFT));
    }

    // Many devices sharing one IP refresh fine.
    foreach ($logins as $login) {
        refreshWith((string) $login->json('data.refresh_token'))->assertOk();
    }

    for ($i = 0; $i < 30; $i++) {
        refreshWith('guess-'.$i)->assertStatus(401);
    }

    refreshWith('guess-final')->assertStatus(429)->assertJsonPath('errors.code', 'TOO_MANY_ATTEMPTS');

    // A valid token from the same IP still works while the failure quota is spent.
    $late = refreshLogin('fp-late-device-0001');
    refreshWith((string) $late->json('data.refresh_token'))->assertOk();
});

it('limits successful refreshes per device', function (): void {
    $token = (string) refreshLogin()->json('data.refresh_token');

    for ($i = 0; $i < 10; $i++) {
        $token = (string) refreshWith($token)->assertOk()->json('data.refresh_token');
    }

    refreshWith($token)->assertStatus(429)->assertJsonPath('errors.code', 'TOO_MANY_ATTEMPTS');

    // Another device is unaffected.
    refreshWith((string) refreshLogin('fp-other-device-0001')->json('data.refresh_token'))->assertOk();
});
