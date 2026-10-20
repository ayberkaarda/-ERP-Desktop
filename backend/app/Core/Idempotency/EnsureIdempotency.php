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
 * A finished request is replayed; the same key with another body is rejected.
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
        $requestHash = $this->requestHash($request);

        $this->purgeExpired($scopeHash);

        $inserted = $this->db->table('idempotency_keys')->insertOrIgnore([
            'id' => (string) Str::uuid7(),
            'scope_hash' => $scopeHash,
            'key' => $key,
            'user_id' => $userId,
            'company_id' => $companyId,
            'method' => $method,
            'path' => '/'.ltrim($request->path(), '/'),
            'request_hash' => $requestHash,
            'status' => 'processing',
            'expires_at' => Carbon::now()->addHours($this->ttlHours),
            'created_at' => Carbon::now(),
            'updated_at' => Carbon::now(),
        ]);

        if ($inserted === 0) {
            return $this->existing($scopeHash, $requestHash);
        }

        try {
            $response = $next($request);
        } catch (Throwable $e) {
            $this->forget($scopeHash);

            throw $e;
        }

        $this->remember($scopeHash, $response);

        return $response;
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

    private function remember(string $scopeHash, Response $response): void
    {
        $status = $response->getStatusCode();

        // Transient failures must stay retryable with the same key.
        if ($status >= 500 || $status === 429) {
            $this->forget($scopeHash);

            return;
        }

        $headers = [];

        foreach (self::KEPT_HEADERS as $name) {
            $value = $response->headers->get($name);

            if ($value !== null) {
                $headers[$name] = $value;
            }
        }

        $body = $response->getContent();

        $this->db->table('idempotency_keys')->where('scope_hash', $scopeHash)->update([
            'status' => 'completed',
            'response_status' => $status,
            'response_headers' => json_encode($headers, JSON_THROW_ON_ERROR),
            'response_body' => $body === false ? '' : $body,
            'updated_at' => Carbon::now(),
        ]);
    }

    private function forget(string $scopeHash): void
    {
        $this->db->table('idempotency_keys')->where('scope_hash', $scopeHash)->delete();
    }

    private function purgeExpired(string $scopeHash): void
    {
        $this->db->table('idempotency_keys')
            ->where('scope_hash', $scopeHash)
            ->where('expires_at', '<', Carbon::now())
            ->delete();
    }

    private function userId(Request $request): ?string
    {
        $id = $request->user()?->getAuthIdentifier();

        return is_string($id) || is_int($id) ? (string) $id : null;
    }

    private function requestHash(Request $request): string
    {
        $body = $request->getContent();

        if ($body === '') {
            $files = array_map(
                static fn (mixed $file): mixed => $file instanceof UploadedFile
                    ? hash_file('sha256', $file->getRealPath())
                    : null,
                $request->allFiles(),
            );
            $body = json_encode([$request->post(), $files], JSON_THROW_ON_ERROR);
        }

        return hash('sha256', $request->getMethod()."\n".$request->path()."\n".$body);
    }
}
