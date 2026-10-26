<?php

declare(strict_types=1);

namespace App\Modules\Identity\Services;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use Illuminate\Cache\RateLimiter;

/**
 * Failed-login lockout per email + ip (5 attempts / 15 minutes by default).
 */
final class LoginThrottle
{
    public function __construct(private readonly RateLimiter $limiter) {}

    public static function key(string $scope, string $subject, ?string $ip): string
    {
        return 'identity:'.$scope.':'.hash('sha256', mb_strtolower(trim($subject)).'|'.($ip ?? ''));
    }

    public function isLocked(string $key): bool
    {
        return $this->limiter->tooManyAttempts($key, $this->maxAttempts());
    }

    /**
     * @return bool true when this failure locked the key
     */
    public function fail(string $key): bool
    {
        $this->limiter->hit($key, $this->decaySeconds());

        return $this->isLocked($key);
    }

    public function clear(string $key): void
    {
        $this->limiter->clear($key);
    }

    public function lockedException(string $key): ApiException
    {
        $seconds = max(1, $this->limiter->availableIn($key));

        return new ApiException(ErrorCode::TooManyAttempts, headers: ['Retry-After' => (string) $seconds]);
    }

    private function maxAttempts(): int
    {
        $value = config('identity.lockout.max_attempts', 5);

        return is_numeric($value) ? (int) $value : 5;
    }

    private function decaySeconds(): int
    {
        $value = config('identity.lockout.decay_seconds', 900);

        return is_numeric($value) ? (int) $value : 900;
    }
}
