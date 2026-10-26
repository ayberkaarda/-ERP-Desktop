<?php

declare(strict_types=1);

namespace App\Core\Idempotency;

use App\Core\Company\CompanyContext;
use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use Closure;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * Middleware alias `idempotent`. POST requires an Idempotency-Key; PUT/PATCH/DELETE honour one if sent.
 *
 * Semantics:
 * - A claim row (status `processing`, with a short lease) is committed first, so concurrent
 *   duplicates get 409 IDEMPOTENCY_IN_PROGRESS; the same key with another fingerprint gets 422.
 * - The handler runs inside a transaction on the default connection that this middleware owns.
 *   The stored response is written in that same transaction, so business writes and the
 *   replayable response commit together or not at all.
 * - On 5xx, 429, 409 or an exception the transaction is rolled back, which proves nothing
 *   committed, and only then is the claim released so the client can retry with the same key.
 * - A claim whose lease ran out may be taken over by a retry. Every later write of the original
 *   request is fenced by its claim id, so a late original rolls back instead of overwriting.
 * - Not covered: side effects outside the default connection (files, mail, other connections).
 *   Handlers must defer those until after commit (afterCommit jobs/events).
 */
final class EnsureIdempotency
{
    public const string HEADER = 'Idempotency-Key';

    public const string REPLAY_HEADER = 'Idempotent-Replayed';

    private const array METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

    /** Headers worth replaying; cookies and session headers never are. */
    private const array KEPT_HEADERS = ['content-type', 'location'];

    public function __construct(
        private readonly ConnectionInterface $db,
        private readonly CompanyContext $company,
        private readonly int $ttlHours = 24,
        private readonly int $leaseSeconds = 300,
    ) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $method = $request->getMethod();

        if (! in_array($method, self::METHODS, true)) {
            return $next($request);
        }

        $key = $request->header(self::HEADER);

        if (! is_string($key) || $key === '') {
            if ($method === 'POST') {
                throw new ApiException(ErrorCode::IdempotencyKeyRequired);
            }

            return $next($request);
        }

        if (strlen($key) > 255) {
            throw new ApiException(ErrorCode::ValidationError, fields: [
                self::HEADER => [__('validation.max.string', ['attribute' => self::HEADER, 'max' => 255])],
            ]);
        }

        $userId = $this->userId($request);
        $companyId = $this->company->idOrNull();
        $scopeHash = hash('sha256', implode("\0", [$userId ?? '', $companyId ?? '', $key]));
        $requestHash = self::fingerprint($request);

        $this->purgeExpired($scopeHash);

        $claimId = (string) Str::uuid7();
        $now = Carbon::now();

        $inserted = $this->db->table('idempotency_keys')->insertOrIgnore([
            'id' => $claimId,
            'scope_hash' => $scopeHash,
            'key' => $key,
            'user_id' => $userId,
            'company_id' => $companyId,
            'method' => $method,
            'path' => '/'.ltrim($request->path(), '/'),
            'request_hash' => $requestHash,
            'status' => 'processing',
            'lease_expires_at' => $now->copy()->addSeconds($this->leaseSeconds),
            'expires_at' => $now->copy()->addHours($this->ttlHours),
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        if ($inserted === 0) {
            return $this->existing($scopeHash, $requestHash);
        }

        $this->db->beginTransaction();

        try {
            $response = $next($request);
        } catch (Throwable $e) {
            $this->abandon($claimId);

            throw $e;
        }

        if (! self::storable($response->getStatusCode())) {
            $this->abandon($claimId);

            return $response;
        }

        if ($this->remember($claimId, $response) === 0) {
            // Our lease expired and a retry took the key over; it owns the outcome now.
            $this->db->rollBack();

            throw new ApiException(ErrorCode::IdempotencyInProgress);
        }

        $this->db->commit();

        return $response;
    }

    /**
     * Canonical request fingerprint: method, path, sorted query, body (or form fields + uploads).
     */
    public static function fingerprint(Request $request): string
    {
        $query = $request->query->all();
        self::sortRecursive($query);

        $body = $request->getContent();

        if ($body === '') {
            $fields = $request->request->all();
            self::sortRecursive($fields);
            $files = self::describeFiles($request->allFiles());
            self::sortRecursive($files);
            $body = json_encode([$fields, $files], JSON_THROW_ON_ERROR);
        }

        return hash('sha256', implode("\n", [
            $request->getMethod(),
            $request->path(),
            http_build_query($query),
            $body,
        ]));
    }

    private static function storable(int $status): bool
    {
        // Transient outcomes must stay retryable with the same key.
        return $status < 500 && $status !== 429 && $status !== 409;
    }

    /**
     * Rolls back everything the handler wrote, then releases only our own claim.
     */
    private function abandon(string $claimId): void
    {
        if ($this->db->transactionLevel() > 0) {
            $this->db->rollBack();
        }

        $this->db->table('idempotency_keys')
            ->where('id', $claimId)
            ->where('status', 'processing')
            ->delete();
    }

    private function existing(string $scopeHash, string $requestHash): Response
    {
        $row = $this->db->table('idempotency_keys')->where('scope_hash', $scopeHash)->first();

        if (! is_object($row)) {
            // Lost a race with expiry cleanup; the client may simply retry.
            throw new ApiException(ErrorCode::IdempotencyInProgress);
        }

        /** @var object{request_hash: string, status: string, response_status: int|null, response_headers: string|null, response_body: string|null} $row */
        if (! hash_equals($row->request_hash, $requestHash)) {
            throw new ApiException(ErrorCode::IdempotencyKeyReused);
        }

        if ($row->status !== 'completed') {
            throw new ApiException(ErrorCode::IdempotencyInProgress);
        }

        $headers = json_decode($row->response_headers ?? '[]', true);
        $headers = is_array($headers) ? $headers : [];
        $headers[self::REPLAY_HEADER] = 'true';

        /** @var array<string, string> $headers */
        return new Response($row->response_body ?? '', (int) $row->response_status, $headers);
    }

    /**
     * @return int affected rows; 0 when the claim is no longer ours
     */
    private function remember(string $claimId, Response $response): int
    {
        $headers = [];

        foreach (self::KEPT_HEADERS as $name) {
            $value = $response->headers->get($name);

            if ($value !== null) {
                $headers[$name] = $value;
            }
        }

        $body = $response->getContent();

        return $this->db->table('idempotency_keys')
            ->where('id', $claimId)
            ->where('status', 'processing')
            ->update([
                'status' => 'completed',
                'response_status' => $response->getStatusCode(),
                'response_headers' => json_encode($headers, JSON_THROW_ON_ERROR),
                'response_body' => $body === false ? '' : $body,
                'lease_expires_at' => null,
                'updated_at' => Carbon::now(),
            ]);
    }

    /**
     * Completed records live for the TTL; processing claims only for their lease.
     */
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

    private function userId(Request $request): ?string
    {
        $id = $request->user()?->getAuthIdentifier();

        return is_string($id) || is_int($id) ? (string) $id : null;
    }

    /**
     * @param  array<array-key, mixed>  $files
     * @return array<array-key, mixed>
     */
    private static function describeFiles(array $files): array
    {
        $out = [];

        foreach ($files as $name => $file) {
            if (is_array($file)) {
                $out[$name] = self::describeFiles($file);
            } elseif ($file instanceof UploadedFile) {
                $path = $file->getRealPath();
                $out[$name] = [
                    'name' => $file->getClientOriginalName(),
                    'size' => $file->getSize(),
                    'sha256' => $path === false ? null : hash_file('sha256', $path),
                ];
            }
        }

        return $out;
    }

    /**
     * @param  array<array-key, mixed>  $value
     */
    private static function sortRecursive(array &$value): void
    {
        ksort($value);

        foreach ($value as &$item) {
            if (is_array($item)) {
                self::sortRecursive($item);
            }
        }
    }
}
