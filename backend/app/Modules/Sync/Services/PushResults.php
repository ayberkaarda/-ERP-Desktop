<?php

declare(strict_types=1);

namespace App\Modules\Sync\Services;

use App\Core\Idempotency\Claim;
use App\Core\Idempotency\IdempotencyScope;
use App\Core\Idempotency\IdempotencyStore;
use App\Core\Idempotency\StoredResponse;
use App\Core\Sync\Mutation;
use App\Core\Sync\SyncConfig;
use App\Core\Sync\WriteOutcome;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Support\Carbon;

/**
 * Push results kept per mutation key in the idempotency store, scope
 * (user, company, 'sync.push', key), for the push retention (7 days); plus the resolutions
 * that superseded stored conflicts.
 */
final readonly class PushResults
{
    public function __construct(
        private IdempotencyStore $store,
        private ConnectionInterface $db,
    ) {}

    public function scope(string $userId, string $companyId, string $key): IdempotencyScope
    {
        return new IdempotencyScope($key, $userId, $companyId, SyncConfig::PUSH_IDEMPOTENCY_SCOPE);
    }

    public function claim(IdempotencyScope $scope, Mutation $mutation, int $ttlSeconds): Claim
    {
        return $this->store->claim($scope, $mutation->fingerprint(), $ttlSeconds, 'POST', '/api/v1/sync/push');
    }

    public function complete(string $claimId, Mutation $mutation, WriteOutcome $outcome): void
    {
        $this->store->complete($claimId, new StoredResponse(200, json_encode([
            'op' => $mutation->op->value,
            'action' => $mutation->action,
            'resource' => $mutation->resource,
            'id' => $mutation->id,
            'payload_hash' => self::payloadHash($mutation->payload),
            'outcome' => $outcome->toArray(),
        ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION)));
    }

    /**
     * Canonical digest of a payload: object keys sorted, list order kept, and JSON numbers by
     * value (an integral float such as 1.0 counts as 1, as JSON itself does not tell them
     * apart). Strings, decimals among them, are compared as sent.
     *
     * @param  array<array-key, mixed>  $payload
     */
    public static function payloadHash(array $payload): string
    {
        $sort = static function (mixed &$value) use (&$sort): void {
            if (is_float($value) && is_finite($value) && floor($value) === $value && abs($value) < 9.2233720368547758E18) {
                $value = (int) $value;

                return;
            }

            if (! is_array($value)) {
                return;
            }

            if (! array_is_list($value)) {
                ksort($value, SORT_STRING);
            }

            foreach ($value as &$item) {
                $sort($item);
            }
        };
        $sort($payload);

        return hash('sha256', json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));
    }

    public function find(IdempotencyScope $scope): ?StoredResult
    {
        $response = $this->store->lookup($scope);

        return $response === null ? null : StoredResult::fromResponse($response);
    }

    public function isSuperseded(IdempotencyScope $resolved): bool
    {
        return $this->db->table('sync_push_resolutions')->where('resolved_scope_hash', $resolved->hash())->exists();
    }

    public function supersede(IdempotencyScope $resolved, string $byKey): void
    {
        $this->db->table('sync_push_resolutions')->insertOrIgnore([
            'resolved_scope_hash' => $resolved->hash(),
            'resolved_key' => $resolved->key,
            'superseded_by' => $byKey,
            'user_id' => $resolved->userId,
            'company_id' => $resolved->companyId,
            'created_at' => Carbon::now(),
        ]);
    }
}
