<?php

declare(strict_types=1);

namespace App\Core\Idempotency;

/**
 * The outcome kept for a key: an HTTP response for the middleware, or any JSON body (with a
 * nominal status) for callers such as sync push that store one result per mutation.
 */
final readonly class StoredResponse
{
    /**
     * @param  array<string, string>  $headers
     */
    public function __construct(
        public int $status,
        public string $body,
        public array $headers = [],
    ) {}
}
