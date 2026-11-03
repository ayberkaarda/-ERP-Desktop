<?php

declare(strict_types=1);

use App\Core\Http\ApiException;
use App\Models\User;
use App\Modules\Identity\Models\DeviceRefreshToken;
use App\Modules\Identity\Models\PersonalAccessToken as DeviceAccessToken;
use App\Modules\Identity\Models\UserDevice;
use App\Modules\Identity\Services\DeviceTokens;
use App\Modules\Identity\Services\TwoFactorService;
use App\Modules\Identity\Services\UserAdministration;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\PersonalAccessToken;
use Laravel\Sanctum\Sanctum;
use PragmaRX\Google2FA\Google2FA;
use Tests\Support\Identity;
use Tests\TestCase;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Identity::boot();
    $this->company = Identity::company();
    $this->user = Identity::member($this->company, ['Sales'], ['email' => 'deniz@example.com']);
});

afterEach(function (): void {
    Sanctum::$accessTokenAuthenticationCallback = null;
    tokenRaceStopListening();
});

/**
 * Runs `$onQuery` after every executed query until the test ends (listeners cannot be removed
 * from the dispatcher, so they are switched off instead).
 *
 * @param  Closure(QueryExecuted): void  $onQuery
 */
function tokenRaceListen(Closure $onQuery): void
{
    $hook = new stdClass;
    $hook->active = true;
    $hook->busy = false;
    TokenRaceHooks::$hooks[] = $hook;

    DB::listen(function (QueryExecuted $query) use ($hook, $onQuery): void {
        // Queries run by the hook itself do not re-enter it.
        if (! $hook->active || $hook->busy) {
            return;
        }

        $hook->busy = true;

        try {
            $onQuery($query);
        } finally {
            $hook->busy = false;
        }
    });
}

function tokenRaceStopListening(): void
{
    foreach (TokenRaceHooks::$hooks as $hook) {
        $hook->active = false;
    }

    TokenRaceHooks::$hooks = [];
}

/**
 * FOR UPDATE queries with the transaction level they ran at (RefreshDatabase itself is level 1).
 *
 * @return ArrayObject<int, array{sql: string, level: int}>
 */
function tokenRaceLockLog(): ArrayObject
{
    $log = new ArrayObject;
    tokenRaceListen(function (QueryExecuted $query) use ($log): void {
        $sql = strtolower($query->sql);

        if (str_contains($sql, 'for update')) {
            $log[] = ['sql' => $sql, 'level' => DB::transactionLevel()];
        }
    });

    return $log;
}

/**
 * @param  ArrayObject<int, array{sql: string, level: int}>  $log
 * @return list<array{sql: string, level: int}>
 */
function tokenRaceLocks(ArrayObject $log, string $table): array
{
    return array_values(array_filter($log->getArrayCopy(), fn (array $entry): bool => str_contains($entry['sql'], 'from "'.$table.'"')));
}

final class TokenRaceHooks
{
    /** @var list<stdClass> */
    public static array $hooks = [];
}

function tokenRaceChangePassword(TestCase $test, ?string $token = null): TestResponse
{
    Identity::fresh();
    $body = [
        'current_password' => Identity::PASSWORD,
        'password' => 'a-brand-new-passphrase',
        'password_confirmation' => 'a-brand-new-passphrase',
    ];

    return $token === null
        ? $test->actingAs(User::query()->findOrFail($test->user->id))->postJson('/api/v1/auth/password/change', $body, Identity::headers())
        : $test->withToken($token)->postJson('/api/v1/auth/password/change', $body, Identity::headers());
}

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

// A recovery code consumed after the password check must not carry a newer auth_version into the login.
it('refuses a recovery-code device login when the password changed after the password check', function (): void {
    $this->user->forceFill([
        'two_factor_secret' => 'JBSWY3DPEHPK3PXP',
        'two_factor_confirmed_at' => now(),
        'two_factor_recovery_codes' => [TwoFactorService::hashCode('AAAAA-AAAAA')],
    ])->save();
    $done = false;

    // Right after the credential lookup: the password check passes against the row it read.
    tokenRaceListen(function (QueryExecuted $query) use (&$done): void {
        if (! $done && str_contains($query->sql, 'from "users" where "email"')) {
            $done = true;
            User::query()->whereKey($this->user->id)->update(['auth_version' => DB::raw('auth_version + 1')]);
        }
    });

    Identity::fresh();
    $this->postJson('/api/v1/auth/device', [
        'email' => 'deniz@example.com', 'password' => Identity::PASSWORD, 'two_factor_code' => 'AAAAA-AAAAA',
        'device_name' => 'Office PC', 'fingerprint' => 'fp-0123456789abcdef',
    ])->assertStatus(401)->assertJsonPath('errors.code', 'UNAUTHENTICATED');

    expect($done)->toBeTrue()
        ->and(UserDevice::query()->count())->toBe(0)
        ->and($this->user->tokens()->count())->toBe(0);
});

it('writes the recovery-code change back without refreshing the rest of the caller model', function (): void {
    $this->user->forceFill([
        'two_factor_secret' => 'JBSWY3DPEHPK3PXP',
        'two_factor_confirmed_at' => now(),
        'two_factor_recovery_codes' => [TwoFactorService::hashCode('AAAAA-AAAAA'), TwoFactorService::hashCode('BBBBB-BBBBB')],
    ])->save();
    $checked = User::query()->findOrFail($this->user->id);
    User::query()->whereKey($this->user->id)->update(['auth_version' => 9]);

    expect(app(TwoFactorService::class)->useRecoveryCode($checked, 'AAAAA-AAAAA'))->toBeTrue()
        ->and($checked->auth_version)->toBe(0)
        ->and($checked->two_factor_recovery_codes)->toBe([TwoFactorService::hashCode('BBBBB-BBBBB')])
        ->and(tokenRaceErrorCode(fn () => tokenRaceIssue($checked)))->toBe('UNAUTHENTICATED');
});

// Enabling 2FA writes the flag and the version bump together: no login sees one without the other.
it('never mints a token without TOTP while two-factor is being enabled', function (): void {
    $service = app(TwoFactorService::class);
    $setup = $service->beginSetup($this->user);
    $checked = User::query()->findOrFail($this->user->id);
    $seen = null;

    tokenRaceListen(function (QueryExecuted $query) use (&$seen, $checked): void {
        if ($seen === null && str_contains($query->sql, 'update "users"') && str_contains($query->sql, '"two_factor_confirmed_at"')) {
            $seen = tokenRaceErrorCode(fn () => tokenRaceIssue($checked)) ?? 'MINTED';
        }
    });

    $service->confirm($this->user, app(Google2FA::class)->getCurrentOtp($setup['secret']));
    tokenRaceStopListening();

    expect($seen)->toBe('UNAUTHENTICATED')
        ->and(UserDevice::query()->count())->toBe(0)
        ->and($this->user->tokens()->count())->toBe(0);
});

it('bumps the auth version from the stored value under the user lock for 2FA and admin resets', function (): void {
    $admin = Identity::member($this->company, ['Admin'], ['email' => 'admin@example.com']);
    $service = app(TwoFactorService::class);
    $log = tokenRaceLockLog();

    $stale = function (int $stored): User {
        User::query()->whereKey($this->user->id)->update(['auth_version' => $stored]);
        $user = User::query()->findOrFail($this->user->id);
        $user->auth_version = 1;

        return $user;
    };

    app(UserAdministration::class)->resetPassword($admin, $stale(5), 'an-admin-chosen-passphrase');
    expect($this->user->fresh()?->auth_version)->toBe(6);

    $setup = $service->beginSetup(User::query()->findOrFail($this->user->id));
    $service->confirm($stale(10), app(Google2FA::class)->getCurrentOtp($setup['secret']));
    expect($this->user->fresh()?->auth_version)->toBe(11);

    $service->disable($stale(20));
    expect($this->user->fresh()?->auth_version)->toBe(21);

    $userLocks = tokenRaceLocks($log, 'users');
    expect($userLocks)->toHaveCount(3)
        ->and(min(array_column($userLocks, 'level')))->toBeGreaterThanOrEqual(2);
});

// M3 / M7: the user row lock is taken, and inside a transaction.
it('takes the user lock inside a transaction on device login and password change', function (): void {
    $log = tokenRaceLockLog();
    tokenRaceLogin();
    expect(tokenRaceLocks($log, 'users'))->not->toBeEmpty()
        ->and(tokenRaceLocks($log, 'users')[0]['level'])->toBeGreaterThanOrEqual(2);

    $log->exchangeArray([]);
    tokenRaceChangePassword($this)->assertNoContent();
    expect(tokenRaceLocks($log, 'users'))->not->toBeEmpty()
        ->and(tokenRaceLocks($log, 'users')[0]['level'])->toBeGreaterThanOrEqual(2);
});

// M14: logout locks the device row before purging it.
it('locks the device row on sign out', function (): void {
    $login = tokenRaceLogin();
    $log = tokenRaceLockLog();

    Identity::fresh();
    $this->withToken((string) $login->json('data.token'))->postJson('/api/v1/auth/logout')->assertNoContent();

    expect(tokenRaceLocks($log, 'user_devices'))->not->toBeEmpty()
        ->and(UserDevice::query()->count())->toBe(0);
});

// M16: tokens minted before the migration carry device_id = null; token_id still finds the device.
it('signs out the device of a legacy token without a device id', function (): void {
    $login = tokenRaceLogin();
    $this->user->tokens()->update(['device_id' => null]);

    Identity::fresh();
    $this->withToken((string) $login->json('data.token'))->postJson('/api/v1/auth/logout')->assertNoContent();

    expect(UserDevice::query()->count())->toBe(0)
        ->and(DeviceRefreshToken::query()->count())->toBe(0)
        ->and($this->user->tokens()->count())->toBe(0);
    Identity::fresh();
    $this->postJson('/api/v1/auth/device/refresh', ['refresh_token' => (string) $login->json('data.refresh_token')])->assertStatus(401);
});

it('reissues for a legacy token without a device id on password change', function (): void {
    $login = tokenRaceLogin();
    $this->user->tokens()->update(['device_id' => null]);

    $issued = tokenRaceChangePassword($this, (string) $login->json('data.token'))->assertOk();

    expect(UserDevice::query()->count())->toBe(1);
    Identity::fresh();
    $this->postJson('/api/v1/auth/device/refresh', ['refresh_token' => (string) $issued->json('data.refresh_token')])->assertOk();
});

// A refresh rotates the device after the password-change request was authenticated by the old token.
it('keeps the changing device signed in when a refresh rotated it during the password change', function (): void {
    $login = tokenRaceLogin();
    $refreshToken = (string) $login->json('data.refresh_token');
    $rotated = null;

    Sanctum::authenticateAccessTokensUsing(function (PersonalAccessToken $token, bool $valid) use (&$rotated, $refreshToken): bool {
        $rotated ??= app(DeviceTokens::class)->refresh($refreshToken, '127.0.0.1');

        return $valid;
    });

    $issued = tokenRaceChangePassword($this, (string) $login->json('data.token'))->assertOk();
    Sanctum::$accessTokenAuthenticationCallback = null;

    expect($rotated)->toBeArray()
        ->and(UserDevice::query()->count())->toBe(1);

    Identity::fresh();
    $this->postJson('/api/v1/auth/device/refresh', ['refresh_token' => $rotated['refresh_token']])->assertStatus(401);
    Identity::fresh();
    $this->postJson('/api/v1/auth/device/refresh', ['refresh_token' => (string) $issued->json('data.refresh_token')])->assertOk();
});
