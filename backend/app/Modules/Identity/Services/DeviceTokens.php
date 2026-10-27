<?php

declare(strict_types=1);

namespace App\Modules\Identity\Services;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Models\User;
use App\Modules\Identity\Events\DeviceSignedIn;
use App\Modules\Identity\Models\DeviceRefreshToken;
use App\Modules\Identity\Models\UserDevice;
use Illuminate\Cache\RateLimiter;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Desktop device tokens: a short-lived Sanctum access token (ability `desktop`) plus a rotating
 * refresh token, one pair per user and fingerprint. Refresh tokens are stored hashed and kept for
 * as long as the device lives, so a stale one that shows up later still revokes the device.
 *
 * Login locks the user before its devices; device operations lock the device before refresh rows.
 */
final class DeviceTokens
{
    public const string ABILITY = 'desktop';

    public function __construct(private readonly RateLimiter $limiter) {}

    /**
     * @return array{token: string, expires_at: string, refresh_token: string, refresh_expires_at: string}
     */
    public function issue(User $user, Request $request, string $name, string $fingerprint): array
    {
        $hash = hash('sha256', $fingerprint);

        return DB::transaction(function () use ($user, $request, $name, $hash): array {
            User::query()->whereKey($user->id)->lockForUpdate()->firstOrFail();
            $device = UserDevice::query()->where('user_id', $user->id)->where('fingerprint_hash', $hash)->lockForUpdate()->first();

            if ($device instanceof UserDevice) {
                DeviceRefreshToken::query()->where('device_id', $device->id)->delete();
                if ($device->token_id !== null) {
                    $user->tokens()->whereKey($device->token_id)->delete();
                }
                event(new DeviceSignedIn($device->id));
            } else {
                $limit = $this->setting('max_devices_per_user', 10);
                $devices = UserDevice::query()->where('user_id', $user->id)
                    ->orderBy('last_used_at')->orderBy('created_at')->orderBy('id')->lockForUpdate()->get();
                foreach ($devices->take(max(0, $devices->count() - $limit + 1)) as $old) {
                    $this->purge($user, $old);
                }
                $device = new UserDevice;
                $device->forceFill(['user_id' => $user->id, 'fingerprint_hash' => $hash]);
            }

            $device->forceFill([
                'name' => $name,
                'ip_address' => $request->ip(),
                'user_agent' => Str::limit((string) $request->userAgent(), 500, ''),
            ]);

            return $this->mintAccess($user, $device, (string) Str::uuid());
        });
    }

    /**
     * Exchanges a refresh token for a new access and refresh token. A refresh token that was already
     * used revokes the device (token theft signal); concurrent refreshes are not supported.
     *
     * @return array{token: string, expires_at: string, refresh_token: string, refresh_expires_at: string}
     *
     * @throws ApiException
     */
    public function refresh(string $plainRefreshToken, ?string $ip): array
    {
        $abuseKey = 'identity:device_refresh_abuse:'.hash('sha256', (string) $ip);

        // The token is checked first: the IP quota only counts and blocks failed attempts, so valid
        // devices behind a shared IP keep refreshing while someone guesses.
        $outcome = $this->rotate($plainRefreshToken);

        if (is_array($outcome)) {
            return $outcome;
        }

        if ($outcome === 'deactivated') {
            throw new ApiException(ErrorCode::UserDeactivated);
        }

        if ($outcome === 'throttled') {
            throw new ApiException(ErrorCode::TooManyAttempts, headers: ['Retry-After' => '60']);
        }

        if ($this->limiter->tooManyAttempts($abuseKey, $this->setting('refresh_failures_per_minute', 30))) {
            throw $this->tooMany($abuseKey);
        }

        $this->limiter->hit($abuseKey, 60);

        throw new ApiException(ErrorCode::Unauthenticated);
    }

    /**
     * Removes the device, its access token and (by cascade) its refresh tokens, under the device lock.
     */
    public function revoke(User $user, UserDevice $device): void
    {
        DB::transaction(function () use ($user, $device): void {
            $locked = UserDevice::query()->whereKey($device->id)->lockForUpdate()->first();

            if ($locked instanceof UserDevice) {
                $this->purge($user, $locked);
            }
        });
    }

    /**
     * Gives a still-signed-in device a new token pair and a new family after its old refresh tokens
     * were invalidated (password change made from that device).
     *
     * @return array{token: string, expires_at: string, refresh_token: string, refresh_expires_at: string}|null
     */
    public function reissue(User $user, UserDevice $device): ?array
    {
        return DB::transaction(function () use ($user, $device): ?array {
            $locked = UserDevice::query()->whereKey($device->id)->lockForUpdate()->first();

            if (! $locked instanceof UserDevice) {
                return null;
            }

            DeviceRefreshToken::query()->where('device_id', $locked->id)->delete();

            if ($locked->token_id !== null) {
                $user->tokens()->whereKey($locked->token_id)->delete();
            }

            return $this->mintAccess($user, $locked, (string) Str::uuid());
        });
    }

    /**
     * @return array{token: string, expires_at: string, refresh_token: string, refresh_expires_at: string}|string|null
     */
    private function rotate(string $plainRefreshToken): array|string|null
    {
        $hash = hash('sha256', $plainRefreshToken);
        $candidate = DeviceRefreshToken::query()->where('token_hash', $hash)->first();

        if (! $candidate instanceof DeviceRefreshToken) {
            return null;
        }

        return DB::transaction(function () use ($candidate, $hash): array|string|null {
            // Device row first (same order as revoke), then the refresh row, re-read under the locks.
            $device = UserDevice::query()->whereKey($candidate->device_id)->lockForUpdate()->first();

            if (! $device instanceof UserDevice) {
                return null;
            }

            $row = DeviceRefreshToken::query()->where('token_hash', $hash)->where('device_id', $device->id)->lockForUpdate()->first();
            $user = User::query()->find($device->user_id);

            if (! $row instanceof DeviceRefreshToken || ! $user instanceof User) {
                return null;
            }

            // Reuse of a spent token: the family is compromised, however old the token is.
            if ($row->used_at !== null) {
                $this->purge($user, $device);

                return null;
            }

            // Unused but past its lifetime, or from before a password/2FA change: the family is dead.
            if ($row->expires_at->isPast() || $row->auth_version !== $user->auth_version) {
                $this->purge($user, $device);

                return null;
            }

            if (! $user->is_active) {
                return 'deactivated';
            }

            $limitKey = 'identity:device_refresh:'.$device->id;

            if ($this->limiter->tooManyAttempts($limitKey, $this->setting('refresh_per_device_per_minute', 10))) {
                return 'throttled';
            }

            $this->limiter->hit($limitKey, 60);
            $row->forceFill(['used_at' => Carbon::now()])->save();

            if ($device->token_id !== null) {
                $user->tokens()->whereKey($device->token_id)->delete();
            }

            return $this->mintAccess($user, $device, $row->family_id);
        });
    }

    /**
     * New access token for a locked device plus the next refresh token of the family.
     *
     * @return array{token: string, expires_at: string, refresh_token: string, refresh_expires_at: string}
     */
    private function mintAccess(User $user, UserDevice $device, string $familyId): array
    {
        $accessExpiresAt = $this->accessExpiry();
        $token = $user->createToken($device->name, [self::ABILITY], $accessExpiresAt);
        $device->forceFill([
            'token_id' => (string) $token->accessToken->getKey(),
            'last_used_at' => Carbon::now(),
            'expires_at' => $accessExpiresAt,
        ])->save();

        return $this->payload($user, $device, $token->plainTextToken, $accessExpiresAt, $familyId);
    }

    /**
     * @return array{token: string, expires_at: string, refresh_token: string, refresh_expires_at: string}
     */
    private function payload(User $user, UserDevice $device, string $plainAccess, Carbon $accessExpiresAt, string $familyId): array
    {
        $days = config('sanctum.device_refresh_ttl_days') ?? config('identity.device_tokens.refresh_ttl_days', 30);
        $refreshExpiresAt = Carbon::now()->addDays(is_numeric($days) ? max(1, (int) $days) : 30);
        $plainRefresh = Str::random(64);

        DeviceRefreshToken::query()->create([
            'device_id' => $device->id,
            'token_hash' => hash('sha256', $plainRefresh),
            'family_id' => $familyId,
            'auth_version' => $user->auth_version,
            'expires_at' => $refreshExpiresAt,
        ]);

        return [
            'token' => $plainAccess,
            'expires_at' => $accessExpiresAt->toIso8601String(),
            'refresh_token' => $plainRefresh,
            'refresh_expires_at' => $refreshExpiresAt->toIso8601String(),
        ];
    }

    /**
     * Caller holds the device lock.
     */
    private function purge(User $user, UserDevice $device): void
    {
        if ($device->token_id !== null) {
            $user->tokens()->whereKey($device->token_id)->delete();
        }

        $device->delete();
    }

    private function accessExpiry(): Carbon
    {
        $minutes = config('sanctum.device_access_ttl_minutes') ?? config('identity.device_tokens.access_ttl_minutes', 60);

        return Carbon::now()->addMinutes(is_numeric($minutes) ? max(1, (int) $minutes) : 60);
    }

    private function setting(string $key, int $default): int
    {
        $value = config('identity.device_tokens.'.$key, $default);

        return is_numeric($value) ? max(1, (int) $value) : $default;
    }

    private function tooMany(string $key): ApiException
    {
        return new ApiException(ErrorCode::TooManyAttempts, headers: ['Retry-After' => (string) max(1, $this->limiter->availableIn($key))]);
    }
}
