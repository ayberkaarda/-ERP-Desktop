<?php

declare(strict_types=1);

namespace App\Modules\Sync\Http\Middleware;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use Closure;
use Illuminate\Contracts\Cache\Lock;
use Illuminate\Contracts\Cache\LockProvider;
use Illuminate\Contracts\Cache\Repository;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * At most sync.throttle.concurrent_pulls_per_device pulls per device (user_devices.id, so a
 * token refresh does not open a second slot) and concurrent_pulls_per_user per user run at once;
 * one more is refused with 429 TOO_MANY_ATTEMPTS (Retry-After 1) before any work. Slots are
 * cache locks released when the pull ends, failed or not; pull_slot_seconds frees the slot of a
 * worker that died mid-pull.
 *
 * The lease bounds the pull itself: while the slot is held, the database ends any transaction
 * or statement of the request after the slot time minus a margin (transaction_timeout and
 * statement_timeout, reset afterwards), so a slow pull fails before its slot can expire and be
 * taken by another pull. The pull's rows are read in one REPEATABLE READ transaction, the part
 * whose length depends on the data.
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
        $bounded = false;

        try {
            foreach ([['device', $device, 'concurrent_pulls_per_device'], ['user', (string) $user->getAuthIdentifier(), 'concurrent_pulls_per_user']] as [$scope, $id, $limit]) {
                $slot = self::acquire($store, $scope, $id, max(1, (int) config("sync.throttle.{$limit}", 1)), $seconds);

                if ($slot === null) {
                    throw new ApiException(ErrorCode::TooManyAttempts, headers: ['Retry-After' => '1']);
                }

                $held[] = $slot;
            }

            $deadline = max(1000, $seconds * 1000 - self::MARGIN_MS);
            $this->db->statement("SET transaction_timeout = {$deadline}");
            $this->db->statement("SET statement_timeout = {$deadline}");
            $bounded = true;

            /** @var Response */
            return $next($request);
        } finally {
            if ($bounded) {
                $this->resetDeadline();
            }

            foreach ($held as $lock) {
                $lock->release();
            }
        }
    }

    private function resetDeadline(): void
    {
        try {
            $this->db->statement('RESET transaction_timeout');
            $this->db->statement('RESET statement_timeout');
        } catch (QueryException) {
            // Inside an aborted transaction the SETs roll back with it; the session is not left bounded.
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
