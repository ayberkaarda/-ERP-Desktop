<?php

declare(strict_types=1);

namespace App\Modules\Identity\Services;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Models\User;
use BaconQrCode\Renderer\Image\SvgImageBackEnd;
use BaconQrCode\Renderer\ImageRenderer;
use BaconQrCode\Renderer\RendererStyle\RendererStyle;
use BaconQrCode\Writer;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use PragmaRX\Google2FA\Google2FA;

/**
 * TOTP with replay protection: a code is accepted only for a time step newer than the last
 * accepted one, claimed atomically. Secret is encrypted at rest; recovery codes are stored hashed.
 */
final class TwoFactorService
{
    public function __construct(private readonly Google2FA $totp) {}

    /**
     * @return array{secret: string, otpauth_url: string, qr_svg: string}
     */
    public function beginSetup(User $user): array
    {
        if ($user->hasTwoFactorEnabled()) {
            throw new ApiException(ErrorCode::ValidationError, __('identity::auth.two_factor_already_enabled'));
        }

        $secret = $this->totp->generateSecretKey(32);

        $user->forceFill([
            'two_factor_secret' => $secret,
            'two_factor_confirmed_at' => null,
            'two_factor_recovery_codes' => null,
            'two_factor_last_timestep' => null,
        ])->save();

        $issuer = config('app.name');
        $url = $this->totp->getQRCodeUrl(is_string($issuer) ? $issuer : 'Keystone', $user->email, $secret);

        return ['secret' => $secret, 'otpauth_url' => $url, 'qr_svg' => $this->svg($url)];
    }

    /**
     * @return list<string> plaintext recovery codes, shown once
     */
    public function confirm(User $user, string $code): array
    {
        if ($user->two_factor_secret === null || $user->two_factor_confirmed_at !== null) {
            throw new ApiException(ErrorCode::ValidationError, __('identity::auth.two_factor_not_pending'));
        }

        if (! $this->verifyCode($user, $code)) {
            throw new ApiException(ErrorCode::InvalidTwoFactorCode);
        }

        $codes = $this->newRecoveryCodes();

        $user->forceFill([
            'two_factor_confirmed_at' => Carbon::now(),
            'two_factor_recovery_codes' => array_map(self::hashCode(...), $codes),
        ])->save();

        return $codes;
    }

    public function disable(User $user): void
    {
        $user->forceFill([
            'two_factor_secret' => null,
            'two_factor_confirmed_at' => null,
            'two_factor_recovery_codes' => null,
            'two_factor_last_timestep' => null,
        ])->save();
    }

    /**
     * Accepts a TOTP code once; the same or an older time step is refused afterwards.
     */
    public function verifyCode(User $user, string $code): bool
    {
        $secret = $user->two_factor_secret;
        $code = preg_replace('/\s+/', '', $code) ?? '';

        if ($secret === null || preg_match('/^\d{6}$/', $code) !== 1) {
            return false;
        }

        $last = $user->two_factor_last_timestep ?? 0;
        $step = $this->totp->verifyKeyNewer($secret, $code, $last, 1);

        if (! is_int($step)) {
            return false;
        }

        // Atomic claim so two concurrent requests with the same code cannot both pass.
        $claimed = User::query()->whereKey($user->id)
            ->where(fn ($q) => $q->whereNull('two_factor_last_timestep')->orWhere('two_factor_last_timestep', '<', $step))
            ->update(['two_factor_last_timestep' => $step]);

        if ($claimed !== 1) {
            return false;
        }

        $user->setRawAttributes(array_merge($user->getAttributes(), ['two_factor_last_timestep' => $step]), true);

        return true;
    }

    public function useRecoveryCode(User $user, string $code): bool
    {
        $hashes = $user->two_factor_recovery_codes ?? [];
        $candidate = self::hashCode($code);

        foreach ($hashes as $i => $hash) {
            if (hash_equals($hash, $candidate)) {
                unset($hashes[$i]);
                $user->forceFill(['two_factor_recovery_codes' => array_values($hashes)])->save();

                return true;
            }
        }

        return false;
    }

    /**
     * Current code for a secret; used by tests and diagnostics only.
     */
    public function currentCode(string $secret): string
    {
        return $this->totp->getCurrentOtp($secret);
    }

    public static function hashCode(string $code): string
    {
        return hash('sha256', strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $code) ?? ''));
    }

    /**
     * @return list<string>
     */
    private function newRecoveryCodes(): array
    {
        $count = config('identity.two_factor.recovery_codes', 8);
        $codes = [];

        for ($i = 0; $i < (is_numeric($count) ? (int) $count : 8); $i++) {
            $codes[] = Str::upper(Str::random(5)).'-'.Str::upper(Str::random(5));
        }

        return $codes;
    }

    private function svg(string $url): string
    {
        $svg = (new Writer(new ImageRenderer(new RendererStyle(192, 1), new SvgImageBackEnd)))->writeString($url);

        return trim((string) preg_replace('/^<\?xml[^>]*\?>/', '', $svg));
    }
}
