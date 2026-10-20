<?php

declare(strict_types=1);

namespace App\Modules\Identity\Services;

use App\Models\User;
use App\Modules\Identity\Models\UserDevice;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * Desktop device tokens: Sanctum token with ability `desktop`, one per user and fingerprint.
 */
final class DeviceTokens
{
    public const string ABILITY = 'desktop';

    /**
     * @return array{token: string, expires_at: string}
     */
    public function issue(User $user, Request $request, string $name, string $fingerprint): array
    {
        $hash = hash('sha256', $fingerprint);

        // A new login from the same device replaces its previous token.
        $previous = UserDevice::query()->where('user_id', $user->id)->where('fingerprint_hash', $hash)->first();

        if ($previous instanceof UserDevice) {
            $this->revoke($user, $previous);
        }

        $days = config('sanctum.device_token_ttl_days') ?? config('identity.device_tokens.ttl_days', 30);
        $expiresAt = Carbon::now()->addDays(is_numeric($days) ? (int) $days : 30);
        $token = $user->createToken($name, [self::ABILITY], $expiresAt);

        UserDevice::query()->create([
            'user_id' => $user->id,
            'token_id' => (string) $token->accessToken->getKey(),
            'name' => $name,
            'fingerprint_hash' => $hash,
            'ip_address' => $request->ip(),
            'user_agent' => Str::limit((string) $request->userAgent(), 500, ''),
            'last_used_at' => Carbon::now(),
            'expires_at' => $expiresAt,
        ]);

        return ['token' => $token->plainTextToken, 'expires_at' => $expiresAt->toIso8601String()];
    }

    public function revoke(User $user, UserDevice $device): void
    {
        if ($device->token_id !== null) {
            $user->tokens()->whereKey($device->token_id)->delete();
        }

        $device->delete();
    }
}
