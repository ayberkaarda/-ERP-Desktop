<?php

declare(strict_types=1);

namespace App\Modules\Sync\Http\Middleware;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use Closure;
use Illuminate\Contracts\Cache\Lock;
use Illuminate\Contracts\Cache\LockProvider;
use Illuminate\Contracts\Cache\Repository;
use Illuminate\Database\Connection;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * At most sync.throttle.concurrent_pulls_per_device pulls per device (user_devices.id, so a
 * token refresh does not open a second slot) and concurrent_pulls_per_user per user run at once;
 * one more is refused with 429 TOO_MANY_ATTEMPTS (Retry-After 1) before any work. Slots are
 * cache locks released when the pull ends, failed or not; pull_slot_seconds frees the slot of a
 * worker that died mid-pull.
 *
 * The lease bounds the whole request (PullLease): from the moment the slot is taken the pull has
 * the slot time minus a margin, across all its statements and transactions; past it, the next
 * statement is refused and a running one is cancelled by the database, so a slow pull fails
 * before its slot can expire and be taken by another pull.
 */
final class LimitConcurrentPulls
{
    /** Time kept between the database deadline and the slot expiry. */
    private const int MARGIN_MS = 5000;

    public function __construct(
        private readonly Repository $cache,
        private readonly ConnectionInterface $db,
    ) {}

    public static function key(string $scope, string $id, int $slot): string
    {
        return "sync:pull:{$scope}:{$id}:{$slot}";
    }

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        $device = EnsureDesktopToken::device($request);
        $store = $this->cache->getStore();

        if ($user === null || $device === null || ! $store instanceof LockProvider) {
            /** @var Response */
            return $next($request);
        }

        $seconds = max(1, (int) config('sync.throttle.pull_slot_seconds', 120));
        $held = [];
        $lease = null;

        try {
            foreach ([['device', $device, 'concurrent_pulls_per_device'], ['user', (string) $user->getAuthIdentifier(), 'concurrent_pulls_per_user']] as [$scope, $id, $limit]) {
                $slot = self::acquire($store, $scope, $id, max(1, (int) config("sync.throttle.{$limit}", 1)), $seconds);

                if ($slot === null) {
                    throw new ApiException(ErrorCode::TooManyAttempts, headers: ['Retry-After' => '1']);
                }

                $held[] = $slot;
            }

            if ($this->db instanceof Connection) {
                $lease = PullLease::begin($this->db, max(1000, $seconds * 1000 - self::MARGIN_MS));
            }

            /** @var Response */
            return $next($request);
        } finally {
            $lease?->end();

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
