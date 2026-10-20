<?php

declare(strict_types=1);

namespace App\Modules\Identity\Services;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Models\User;
use App\Modules\Identity\Enums\SessionEvent;
use Illuminate\Contracts\Cache\Repository;
use Illuminate\Contracts\Hashing\Hasher;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * Password check with lockout and without user enumeration: unknown emails cost the same
 * hash verification and get the same answer as wrong passwords.
 */
final class CredentialVerifier
{
    public const string DUMMY_HASH_KEY = 'identity:dummy_password_hash';

    public function __construct(
        private readonly Hasher $hasher,
        private readonly Repository $cache,
        private readonly LoginThrottle $throttle,
        private readonly SessionLogger $logger,
    ) {}

    /**
     * @throws ApiException
     */
    public function verify(Request $request, string $email, string $password): User
    {
        $key = $this->key($request, $email);

        if ($this->throttle->isLocked($key)) {
            throw $this->throttle->lockedException($key);
        }

        $user = User::query()->where('email', mb_strtolower(trim($email)))->first();
        $valid = $this->hasher->check($password, $user instanceof User ? $user->password : $this->dummyHash());

        if (! $user instanceof User || ! $valid) {
            $this->logger->log(SessionEvent::Failed, $request, $user, $email);

            if ($this->throttle->fail($key)) {
                $this->logger->log(SessionEvent::Lockout, $request, $user, $email);
            }

            throw new ApiException(ErrorCode::ValidationError, __('identity::auth.failed'), [
                'email' => [__('identity::auth.failed')],
            ]);
        }

        if (! $user->is_active) {
            $this->logger->log(SessionEvent::Failed, $request, $user, $email);

            throw new ApiException(ErrorCode::UserDeactivated);
        }

        return $user;
    }

    public function key(Request $request, string $email): string
    {
        return LoginThrottle::key('login', $email, $request->ip());
    }

    public function clear(Request $request, string $email): void
    {
        $this->throttle->clear($this->key($request, $email));
    }

    /**
     * Precomputed with the configured hasher settings and kept in the cache, so an unknown email
     * costs exactly one hash verification, like a known one (computed once per cache lifetime).
     */
    private function dummyHash(): string
    {
        return $this->cache->rememberForever(self::DUMMY_HASH_KEY, fn (): string => $this->hasher->make(Str::random(40)));
    }
}
