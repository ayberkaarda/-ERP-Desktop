<?php

declare(strict_types=1);

namespace App\Core\Idempotency;

use Illuminate\Database\ConnectionInterface;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * The idempotency_keys table: claim a key, then complete it with the outcome or release it.
 *
 * - claim() commits nothing by itself; it inserts a `processing` row with a short lease, or
 *   reports what the existing row says (completed / reused / in progress).
 * - A claim whose lease ran out may be taken over by a retry. complete() and release() are
 *   fenced by the claim id, so a late original can no longer overwrite the new holder.
 * - Completed rows live for the TTL given to claim(); processing rows only for their lease.
 *
 * Transactions are the caller's: EnsureIdempotency wraps a whole HTTP request, sync push wraps
 * each mutation, and both complete() inside the transaction that holds the business writes.
 */
final class IdempotencyStore
{
    public function __construct(
        private readonly ConnectionInterface $db,
        private readonly int $leaseSeconds = 300,
    ) {}

    /**
     * @param  string  $requestHash  fingerprint of the request; the same key with another one is reuse
     */
    public function claim(
        IdempotencyScope $scope,
        string $requestHash,
        int $ttlSeconds,
        string $method = 'POST',
        string $path = '',
    ): Claim {
        $scopeHash = $scope->hash();
        $this->purgeExpired($scopeHash);

        $claimId = (string) Str::uuid7();
        $now = Carbon::now();

        $inserted = $this->db->table('idempotency_keys')->insertOrIgnore([
            'id' => $claimId,
            'scope_hash' => $scopeHash,
            'key' => $scope->key,
            'user_id' => $scope->userId,
            'company_id' => $scope->companyId,
            'method' => $method,
            'path' => $path,
            'request_hash' => $requestHash,
            'status' => 'processing',
            'lease_expires_at' => $now->copy()->addSeconds($this->leaseSeconds),
            'expires_at' => $now->copy()->addSeconds($ttlSeconds),
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        if ($inserted !== 0) {
            return Claim::claimed($claimId);
        }

        $row = $this->row($scopeHash);

        if ($row === null) {
            // Lost a race with expiry cleanup; the client may simply retry.
            return Claim::inProgress();
        }

        if (! hash_equals($row->request_hash, $requestHash)) {
            return Claim::reused();
        }

        if ($row->status !== 'completed') {
            return Claim::inProgress();
        }

        return Claim::completed(self::response($row));
    }

    /**
     * Stores the outcome of a claim we still hold.
     *
     * @return bool false when the lease ran out and a retry owns the key now
     */
    public function complete(string $claimId, StoredResponse $response): bool
    {
        return $this->db->table('idempotency_keys')
            ->where('id', $claimId)
            ->where('status', 'processing')
            ->update([
                'status' => 'completed',
                'response_status' => $response->status,
                'response_headers' => json_encode((object) $response->headers, JSON_THROW_ON_ERROR),
                'response_body' => $response->body,
                'lease_expires_at' => null,
                'updated_at' => Carbon::now(),
            ]) > 0;
    }

    /**
     * Gives the key back so the same request can be retried; only our own unfinished claim.
     */
    public function release(string $claimId): void
    {
        $this->db->table('idempotency_keys')
            ->where('id', $claimId)
            ->where('status', 'processing')
            ->delete();
    }

    /**
     * The completed, unexpired outcome stored for a key, if any.
     */
    public function lookup(IdempotencyScope $scope): ?StoredResponse
    {
        $row = $this->row($scope->hash());

        if ($row === null || $row->status !== 'completed' || Carbon::parse($row->expires_at)->isPast()) {
            return null;
        }

        return self::response($row);
    }

    /**
     * Deletes every expired row; returns how many.
     */
    public function prune(): int
    {
        $now = Carbon::now();

        return $this->db->table('idempotency_keys')
            ->where(function ($q) use ($now): void {
                $q->where(fn ($c) => $c->where('status', 'completed')->where('expires_at', '<', $now))
                    ->orWhere(fn ($p) => $p->where('status', 'processing')->where('lease_expires_at', '<', $now));
            })
            ->delete();
    }

    private function purgeExpired(string $scopeHash): void
    {
        $now = Carbon::now();

        $this->db->table('idempotency_keys')
            ->where('scope_hash', $scopeHash)
            ->where(function ($q) use ($now): void {
                $q->where(fn ($c) => $c->where('status', 'completed')->where('expires_at', '<', $now))
                    ->orWhere(fn ($p) => $p->where('status', 'processing')->where('lease_expires_at', '<', $now));
            })
            ->delete();
    }

    /**
     * @return object{request_hash: string, status: string, expires_at: string, response_status: int|null, response_headers: string|null, response_body: string|null}|null
     */
    private function row(string $scopeHash): ?object
    {
        $row = $this->db->table('idempotency_keys')->where('scope_hash', $scopeHash)->first();

        /** @var object{request_hash: string, status: string, expires_at: string, response_status: int|null, response_headers: string|null, response_body: string|null}|null $row */
        return is_object($row) ? $row : null;
    }

    /**
     * @param  object{response_status: int|null, response_headers: string|null, response_body: string|null}  $row
     */
    private static function response(object $row): StoredResponse
    {
        $headers = json_decode($row->response_headers ?? '[]', true);
        $headers = is_array($headers) ? array_filter($headers, 'is_string') : [];

        /** @var array<string, string> $headers */
        return new StoredResponse((int) $row->response_status, $row->response_body ?? '', $headers);
    }
}
