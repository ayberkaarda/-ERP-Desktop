<?php

declare(strict_types=1);

namespace App\Modules\Sync\Http\Middleware;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use Closure;
use Illuminate\Contracts\Cache\Lock;
use Illuminate\Contracts\Cache\LockProvider;
use Illuminate\Contracts\Cache\Repository;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * At most sync.throttle.concurrent_pulls_per_device pulls per device token and
 * concurrent_pulls_per_user per user run at once; one more is refused with 429
 * TOO_MANY_ATTEMPTS (Retry-After 1) before any work. Slots are cache locks released when the
 * pull ends, failed or not; pull_slot_seconds frees the slot of a worker that died mid-pull.
 */
final class LimitConcurrentPulls
{
    public function __construct(private readonly Repository $cache) {}

    public static function key(string $scope, string $id, int $slot): string
    {
        return "sync:pull:{$scope}:{$id}:{$slot}";
    }

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        $token = $request->attributes->get(EnsureDesktopToken::TOKEN_ATTRIBUTE);
        $store = $this->cache->getStore();

        if ($user === null || ! is_string($token) || ! $store instanceof LockProvider) {
            /** @var Response */
            return $next($request);
        }

        $seconds = max(1, (int) config('sync.throttle.pull_slot_seconds', 120));
        $held = [];

        try {
            foreach ([['device', $token, 'concurrent_pulls_per_device'], ['user', (string) $user->getAuthIdentifier(), 'concurrent_pulls_per_user']] as [$scope, $id, $limit]) {
                $slot = self::acquire($store, $scope, $id, max(1, (int) config("sync.throttle.{$limit}", 1)), $seconds);

                if ($slot === null) {
                    throw new ApiException(ErrorCode::TooManyAttempts, headers: ['Retry-After' => '1']);
                }

                $held[] = $slot;
            }

            /** @var Response */
            return $next($request);
        } finally {
            foreach ($held as $lock) {
                $lock->release();
            }
        }
    }

    private static function acquire(LockProvider $store, string $scope, string $id, int $slots, int $seconds): ?Lock
    {
        for ($slot = 0; $slot < $slots; $slot++) {
            $lock = $store->lock(self::key($scope, $id, $slot), $seconds);

            if ($lock->get()) {
                return $lock;
            }
        }

        return null;
    }
}
