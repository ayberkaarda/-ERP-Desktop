<?php

declare(strict_types=1);

use App\Modules\Identity\Models\UserDevice;
use App\Modules\Identity\Models\UserSession;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use PragmaRX\Google2FA\Google2FA;
use Tests\Support\Identity;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Identity::boot();
    $this->company = Identity::company();
    $this->user = Identity::member($this->company, ['Sales'], ['email' => 'deniz@example.com']);
    $this->other = Identity::member($this->company, ['Sales'], ['email' => 'other@example.com']);
});

function browserLogin(string $email, string $agent = 'BrowserA'): string
{
    Identity::fresh();
    $response = test()->withServerVariables(['HTTP_USER_AGENT' => $agent])
        ->postJson('/api/v1/auth/login', ['email' => $email, 'password' => Identity::PASSWORD], Identity::headers())
        ->assertOk();

    return Identity::sessionCookie($response);
}

function asBrowser(string $cookie): mixed
{
    Identity::fresh();

    return test()->withCredentials()->withCookie((string) config('session.cookie'), $cookie);
}

function deviceLogin(array $payload): TestResponse
{
    Identity::fresh();

    return test()->postJson('/api/v1/auth/device', array_merge([
        'email' => 'deniz@example.com',
        'password' => Identity::PASSWORD,
        'device_name' => 'Office PC',
        'fingerprint' => 'fp-0123456789abcdef',
    ], $payload));
}

it('lists own sessions in the contract shape and marks the current one', function (): void {
    $first = browserLogin('deniz@example.com', 'BrowserA');
    browserLogin('deniz@example.com', 'BrowserB');
    browserLogin('other@example.com');

    $items = asBrowser($first)->getJson('/api/v1/auth/sessions', Identity::headers())
        ->assertOk()
        ->assertJsonCount(2, 'data')
        ->assertJsonStructure(['data' => [['id', 'ip_address', 'user_agent', 'last_active_at', 'is_current']]])
        ->json('data');

    $current = collect($items)->firstWhere('is_current', true);
    expect($current['user_agent'])->toBe('BrowserA')
        ->and(collect($items)->where('is_current', true))->toHaveCount(1)
        ->and(json_encode($items))->not->toContain('session_hash');
});

it('revokes another session by removing it from the session store', function (): void {
    $keep = browserLogin('deniz@example.com', 'BrowserA');
    $victim = browserLogin('deniz@example.com', 'BrowserB');
    $row = UserSession::query()->where('user_agent', 'BrowserB')->firstOrFail();

    asBrowser($keep)->deleteJson("/api/v1/auth/sessions/{$row->id}", [], Identity::headers())->assertNoContent();

    expect(DB::table('sessions')->where('id', $victim)->exists())->toBeFalse()
        ->and(UserSession::query()->whereKey($row->id)->exists())->toBeFalse();

    asBrowser($victim)->getJson('/api/v1/auth/me', Identity::headers())->assertStatus(401);
    asBrowser($keep)->getJson('/api/v1/auth/me', Identity::headers())->assertOk();
});

it('cannot see or revoke another user\'s session (IDOR)', function (): void {
    $mine = browserLogin('deniz@example.com');
    $theirs = browserLogin('other@example.com');
    $row = UserSession::query()->where('user_id', $this->other->id)->firstOrFail();

    asBrowser($mine)->deleteJson("/api/v1/auth/sessions/{$row->id}", [], Identity::headers())->assertNotFound();
    asBrowser($theirs)->getJson('/api/v1/auth/me', Identity::headers())->assertOk();
});

it('does not let a super admin revoke someone else\'s session through /auth/sessions', function (): void {
    $admin = Identity::member($this->company, [], ['is_super_admin' => true, 'email' => 'root@example.com']);
    browserLogin('other@example.com');
    $row = UserSession::query()->where('user_id', $this->other->id)->firstOrFail();

    Identity::fresh();
    $this->actingAs($admin)->deleteJson("/api/v1/auth/sessions/{$row->id}", [], Identity::headers())->assertNotFound();
});

it('issues one desktop token per fingerprint and lists and revokes devices', function (): void {
    $first = deviceLogin([])->assertOk()->assertJsonStructure(['data' => ['token', 'expires_at', 'refresh_token', 'refresh_expires_at']]);
    $second = deviceLogin([])->assertOk();

    expect(UserDevice::query()->where('user_id', $this->user->id)->count())->toBe(1)
        ->and($this->user->tokens()->count())->toBe(1)
        ->and($this->user->tokens()->first()?->can('desktop'))->toBeTrue()
        ->and($this->user->tokens()->first()?->expires_at)->not->toBeNull();

    Identity::fresh();
    $this->withToken((string) $first->json('data.token'))->getJson('/api/v1/auth/me')->assertStatus(401);

    Identity::fresh();
    $devices = $this->withToken((string) $second->json('data.token'))->getJson('/api/v1/me/devices')
        ->assertOk()->assertJsonCount(1, 'data')->json('data');
    expect(json_encode($devices))->not->toContain('fingerprint');

    Identity::fresh();
    $this->withToken((string) $second->json('data.token'))->deleteJson("/api/v1/me/devices/{$devices[0]['id']}")->assertNoContent();

    Identity::fresh();
    $this->withToken((string) $second->json('data.token'))->getJson('/api/v1/auth/me')->assertStatus(401);
});

it('cannot revoke another user\'s device (IDOR)', function (): void {
    deviceLogin([])->assertOk();
    $device = UserDevice::query()->firstOrFail();

    Identity::fresh();
    $this->actingAs($this->other)->deleteJson("/api/v1/me/devices/{$device->id}")->assertNotFound();
    expect(UserDevice::query()->count())->toBe(1);
});

it('requires and checks the TOTP code for device login, with replay protection', function (): void {
    $secret = app(Google2FA::class)->generateSecretKey(32);
    $this->user->forceFill(['two_factor_secret' => $secret, 'two_factor_confirmed_at' => now()])->save();

    deviceLogin([])->assertStatus(401)->assertJsonPath('errors.code', 'TWO_FACTOR_REQUIRED');
    deviceLogin(['two_factor_code' => '000000'])->assertStatus(422)->assertJsonPath('errors.code', 'INVALID_TWO_FACTOR_CODE');

    $code = app(Google2FA::class)->getCurrentOtp($secret);
    deviceLogin(['two_factor_code' => $code])->assertOk();
    deviceLogin(['two_factor_code' => $code])->assertStatus(422);
});

it('applies the login lockout to device login', function (): void {
    foreach (range(1, 5) as $_) {
        deviceLogin(['password' => 'wrong-password-123'])->assertStatus(422);
    }

    deviceLogin([])->assertStatus(429);
});
