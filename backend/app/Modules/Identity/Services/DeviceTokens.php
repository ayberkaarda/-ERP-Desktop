<?php

declare(strict_types=1);

namespace App\Modules\Identity\Services;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Models\User;
use App\Modules\Identity\Models\DeviceRefreshToken;
use App\Modules\Identity\Models\UserDevice;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Desktop device tokens: a short-lived Sanctum access token (ability `desktop`) plus a rotating
 * refresh token, one pair per user and fingerprint. Refresh tokens are stored hashed; presenting
 * a used one again revokes the whole device.
 */
final class DeviceTokens
{
    public const string ABILITY = 'desktop';

    /**
     * @return array{token: string, expires_at: string, refresh_token: string, refresh_expires_at: string}
     */
    public function issue(User $user, Request $request, string $name, string $fingerprint): array
    {
        $hash = hash('sha256', $fingerprint);

        // A new login from the same device replaces its previous token.
        $previous = UserDevice::query()->where('user_id', $user->id)->where('fingerprint_hash', $hash)->first();

        if ($previous instanceof UserDevice) {
            $this->revoke($user, $previous);
        }

        return DB::transaction(function () use ($user, $request, $name, $hash): array {
            $accessExpiresAt = $this->accessExpiry();
            $token = $user->createToken($name, [self::ABILITY], $accessExpiresAt);

            $device = UserDevice::query()->create([
                'user_id' => $user->id,
                'token_id' => (string) $token->accessToken->getKey(),
                'name' => $name,
                'fingerprint_hash' => $hash,
                'ip_address' => $request->ip(),
                'user_agent' => Str::limit((string) $request->userAgent(), 500, ''),
                'last_used_at' => Carbon::now(),
                'expires_at' => $accessExpiresAt,
            ]);

            [$refresh, $refreshExpiresAt] = $this->newRefreshToken($device, (string) Str::uuid());

            return [
                'token' => $token->plainTextToken,
                'expires_at' => $accessExpiresAt->toIso8601String(),
                'refresh_token' => $refresh,
                'refresh_expires_at' => $refreshExpiresAt->toIso8601String(),
            ];
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
    public function refresh(string $plainRefreshToken): array
    {
        $outcome = DB::transaction(function () use ($plainRefreshToken): array|string|null {
            $row = DeviceRefreshToken::query()
                ->where('token_hash', hash('sha256', $plainRefreshToken))
                ->lockForUpdate()
                ->first();

            if (! $row instanceof DeviceRefreshToken) {
                return null;
            }

            $device = UserDevice::query()->find($row->device_id);
            $user = $device instanceof UserDevice ? User::query()->find($device->user_id) : null;

            if (! $device instanceof UserDevice || ! $user instanceof User) {
                return null;
            }

            if ($row->used_at !== null || $row->expires_at->isPast()) {
                $this->revoke($user, $device);

                return null;
            }

            if (! $user->is_active) {
                return 'deactivated';
            }

            $row->forceFill(['used_at' => Carbon::now()])->save();

            if ($device->token_id !== null) {
                $user->tokens()->whereKey($device->token_id)->delete();
            }

            $accessExpiresAt = $this->accessExpiry();
            $token = $user->createToken($device->name, [self::ABILITY], $accessExpiresAt);
            $device->forceFill([
                'token_id' => (string) $token->accessToken->getKey(),
                'last_used_at' => Carbon::now(),
                'expires_at' => $accessExpiresAt,
            ])->save();

            // Used rows past their lifetime are no longer needed for reuse detection.
            DeviceRefreshToken::query()->where('device_id', $device->id)->whereNotNull('used_at')
                ->where('expires_at', '<', Carbon::now())->delete();

            [$refresh, $refreshExpiresAt] = $this->newRefreshToken($device, $row->family_id);

            return [
                'token' => $token->plainTextToken,
                'expires_at' => $accessExpiresAt->toIso8601String(),
                'refresh_token' => $refresh,
                'refresh_expires_at' => $refreshExpiresAt->toIso8601String(),
            ];
        });

        if ($outcome === 'deactivated') {
            throw new ApiException(ErrorCode::UserDeactivated);
        }

        if (! is_array($outcome)) {
            throw new ApiException(ErrorCode::Unauthenticated);
        }

        /** @var array{token: string, expires_at: string, refresh_token: string, refresh_expires_at: string} $outcome */
        return $outcome;
    }

    /**
     * Removes the device, its access token and (by cascade) its refresh tokens.
     */
    public function revoke(User $user, UserDevice $device): void
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

    /**
     * @return array{0: string, 1: Carbon}
     */
    private function newRefreshToken(UserDevice $device, string $familyId): array
    {
        $days = config('sanctum.device_refresh_ttl_days') ?? config('identity.device_tokens.refresh_ttl_days', 30);
        $expiresAt = Carbon::now()->addDays(is_numeric($days) ? max(1, (int) $days) : 30);
        $plain = Str::random(64);

        DeviceRefreshToken::query()->create([
            'device_id' => $device->id,
            'token_hash' => hash('sha256', $plain),
            'family_id' => $familyId,
            'expires_at' => $expiresAt,
        ]);

        return [$plain, $expiresAt];
    }
}
