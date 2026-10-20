<?php

declare(strict_types=1);

use App\Models\User;
use App\Modules\Identity\Services\TwoFactorService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use PragmaRX\Google2FA\Google2FA;
use Tests\Support\Identity;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Identity::boot();
    $this->company = Identity::company();
    $this->user = Identity::member($this->company, ['Sales'], ['email' => 'mert@example.com']);
    $this->totp = app(TwoFactorService::class);
});

function enableTwoFactor(User $user): string
{
    $secret = app(Google2FA::class)->generateSecretKey(32);
    $user->forceFill([
        'two_factor_secret' => $secret,
        'two_factor_confirmed_at' => now(),
        'two_factor_recovery_codes' => [TwoFactorService::hashCode('AAAAA-BBBBB'), TwoFactorService::hashCode('CCCCC-DDDDD')],
    ])->save();

    return $secret;
}

/**
 * @return array{0: TestResponse, 1: string}
 */
function passwordStep(string $email): array
{
    Identity::fresh();
    $response = test()->postJson('/api/v1/auth/login', ['email' => $email, 'password' => Identity::PASSWORD], Identity::headers());

    return [$response, Identity::sessionCookie($response)];
}

function withSession(string $cookie): mixed
{
    Identity::fresh();

    return test()->withCredentials()->withCookie((string) config('session.cookie'), $cookie);
}

it('sets up, stores the secret encrypted and confirms with recovery codes stored hashed', function (): void {
    $setup = $this->actingAs($this->user)->postJson('/api/v1/auth/two-factor/setup', [], Identity::headers())
        ->assertOk()
        ->assertJsonStructure(['data' => ['secret', 'otpauth_url', 'qr_svg']]);

    $secret = $setup->json('data.secret');
    expect($setup->json('data.qr_svg'))->toStartWith('<svg')
        ->and($setup->json('data.otpauth_url'))->toStartWith('otpauth://totp/')
        ->and(DB::table('users')->where('id', $this->user->id)->value('two_factor_secret'))->not->toContain($secret);

    $this->actingAs($this->user)->postJson('/api/v1/auth/two-factor/confirm', ['code' => '000000'], Identity::headers())
        ->assertStatus(422)
        ->assertJsonPath('errors.code', 'INVALID_TWO_FACTOR_CODE');

    $codes = $this->actingAs($this->user)
        ->postJson('/api/v1/auth/two-factor/confirm', ['code' => $this->totp->currentCode($secret)], Identity::headers())
        ->assertOk()
        ->json('data.recovery_codes');

    $raw = (string) DB::table('users')->where('id', $this->user->id)->value('two_factor_recovery_codes');
    expect($codes)->toHaveCount(8)
        ->and(decrypt($raw, false))->not->toContain($codes[0])
        ->and($this->user->fresh()?->hasTwoFactorEnabled())->toBeTrue();

    $this->actingAs($this->user)->postJson('/api/v1/auth/two-factor/setup', [], Identity::headers())
        ->assertStatus(422);
});

it('keeps the session unauthenticated until the second factor is verified', function (): void {
    $secret = enableTwoFactor($this->user);
    [$response, $cookie] = passwordStep('mert@example.com');

    $response->assertOk()->assertJsonPath('data.two_factor_required', true)->assertJsonPath('data.user', null);

    withSession($cookie)->getJson('/api/v1/auth/me', Identity::headers())->assertStatus(401);

    $verified = withSession($cookie)
        ->postJson('/api/v1/auth/two-factor/verify', ['code' => $this->totp->currentCode($secret)], Identity::headers())
        ->assertOk()
        ->assertJsonPath('data.user.id', $this->user->id)
        ->assertJsonPath('data.user.two_factor_enabled', true);

    withSession(Identity::sessionCookie($verified))->getJson('/api/v1/auth/me', Identity::headers())->assertOk();
});

it('refuses a replayed code', function (): void {
    $secret = enableTwoFactor($this->user);
    $code = $this->totp->currentCode($secret);

    [, $cookie] = passwordStep('mert@example.com');
    withSession($cookie)->postJson('/api/v1/auth/two-factor/verify', ['code' => $code], Identity::headers())->assertOk();

    [, $second] = passwordStep('mert@example.com');
    withSession($second)->postJson('/api/v1/auth/two-factor/verify', ['code' => $code], Identity::headers())
        ->assertStatus(422)
        ->assertJsonPath('errors.code', 'INVALID_TWO_FACTOR_CODE');
});

it('accepts each recovery code once', function (): void {
    enableTwoFactor($this->user);

    [, $cookie] = passwordStep('mert@example.com');
    withSession($cookie)->postJson('/api/v1/auth/two-factor/verify', ['recovery_code' => 'aaaaa-bbbbb'], Identity::headers())->assertOk();

    [, $second] = passwordStep('mert@example.com');
    withSession($second)->postJson('/api/v1/auth/two-factor/verify', ['recovery_code' => 'AAAAA-BBBBB'], Identity::headers())->assertStatus(422);

    expect($this->user->fresh()?->two_factor_recovery_codes)->toHaveCount(1);
});

it('needs a pending challenge and throttles guessing', function (): void {
    enableTwoFactor($this->user);

    $this->postJson('/api/v1/auth/two-factor/verify', ['code' => '123456'], Identity::headers())->assertStatus(401);

    [, $cookie] = passwordStep('mert@example.com');

    foreach (range(1, 5) as $_) {
        withSession($cookie)->postJson('/api/v1/auth/two-factor/verify', ['code' => '000000'], Identity::headers())->assertStatus(422);
    }

    withSession($cookie)->postJson('/api/v1/auth/two-factor/verify', ['code' => '000000'], Identity::headers())
        ->assertStatus(429)
        ->assertJsonPath('errors.code', 'TOO_MANY_ATTEMPTS');
});

it('disables only with the current password', function (): void {
    enableTwoFactor($this->user);

    $this->actingAs($this->user)->deleteJson('/api/v1/auth/two-factor', ['password' => 'wrong-password-123'], Identity::headers())
        ->assertStatus(422);
    $this->actingAs($this->user)->deleteJson('/api/v1/auth/two-factor', ['password' => Identity::PASSWORD], Identity::headers())
        ->assertNoContent();

    expect($this->user->fresh()?->hasTwoFactorEnabled())->toBeFalse();
});
