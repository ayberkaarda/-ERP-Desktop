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
 *
 * Storage, fencing and expiry live in IdempotencyStore.
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
        private readonly IdempotencyStore $store,
        private readonly int $ttlHours = 24,
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

        $claim = $this->store->claim(
            new IdempotencyScope($key, $this->userId($request), $this->company->idOrNull()),
            self::fingerprint($request),
            $this->ttlHours * 3600,
            $method,
            '/'.ltrim($request->path(), '/'),
        );

        if ($claim->status !== ClaimStatus::Claimed || $claim->claimId === null) {
            return self::existing($claim);
        }

        $claimId = $claim->claimId;
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

        if (! $this->store->complete($claimId, self::stored($response))) {
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

        $this->store->release($claimId);
    }

    private static function existing(Claim $claim): Response
    {
        if ($claim->status === ClaimStatus::Reused) {
            throw new ApiException(ErrorCode::IdempotencyKeyReused);
        }

        $stored = $claim->response;

        if ($claim->status !== ClaimStatus::Completed || $stored === null) {
            throw new ApiException(ErrorCode::IdempotencyInProgress);
        }

        $headers = $stored->headers;
        $headers[self::REPLAY_HEADER] = 'true';

        return new Response($stored->body, $stored->status, $headers);
    }

    private static function stored(Response $response): StoredResponse
    {
        $headers = [];

        foreach (self::KEPT_HEADERS as $name) {
            $value = $response->headers->get($name);

            if ($value !== null) {
                $headers[$name] = $value;
            }
        }

        $body = $response->getContent();

        return new StoredResponse($response->getStatusCode(), $body === false ? '' : $body, $headers);
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
